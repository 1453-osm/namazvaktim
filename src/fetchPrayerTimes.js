const DiyanetApiService = require('./services/diyanetApi');
const StorageService = require('./services/gcsService');
const CityService = require('./services/cityService');

class PrayerTimesFetcher {
  constructor() {
    this.diyanetApi = new DiyanetApiService();
    this.gcsService = new StorageService();
    this.cityService = new CityService();
    this.PARALLEL_WORKERS = 20; // 20 paralel işlem
  }

  /**
   * Şehir listesini paralel işlem için gruplara böl
   * @param {Array} cityIds - Şehir ID'leri
   * @param {number} groupCount - Grup sayısı
   */
  divideIntoGroups(cityIds, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    
    cityIds.forEach((cityId, index) => {
      const groupIndex = index % groupCount;
      groups[groupIndex].push(cityId);
    });
    
    return groups.filter(group => group.length > 0);
  }

  /**
   * Tek bir grup için namaz vakitlerini al (paralel worker)
   * @param {Array} cityIds - Bu grubun şehir ID'leri
   * @param {number} year - Yıl
   * @param {number} workerId - Worker ID'si
   */
  async fetchPrayerTimesForGroup(cityIds, year, workerId) {
    const results = {
      workerId,
      totalCities: cityIds.length,
      successCount: 0,
      errorCount: 0,
      errors: []
    };

    console.log(`[Worker ${workerId}] Başlatıldı - ${cityIds.length} şehir işlenecek`);

    // Rate limiting için delay function
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < cityIds.length; i++) {
      const cityId = cityIds[i];
      
      try {
        console.log(`[Worker ${workerId}] [${i + 1}/${cityIds.length}] Şehir ${cityId} işleniyor...`);
        
        // Şehir detaylarını al
        const cityDetails = await this.cityService.getCityDetails(cityId);
        if (!cityDetails) {
          console.warn(`[Worker ${workerId}] Şehir ${cityId} bulunamadı, atlanıyor...`);
          results.errorCount++;
          results.errors.push({ cityId, error: 'Şehir bulunamadı' });
          continue;
        }

        console.log(`[Worker ${workerId}] Şehir: ${cityDetails.fullName}`);

        // Dosya zaten var mı kontrol et
        const fileName = this.gcsService.generatePrayerTimeFileName(cityId, year);
        const fileExists = await this.gcsService.fileExists(fileName);
        
        if (fileExists) {
          console.log(`[Worker ${workerId}] Dosya zaten mevcut: ${fileName}, atlanıyor...`);
          results.successCount++;
          continue;
        }

        // Namaz vakitlerini al
        const prayerTimes = await this.diyanetApi.getYearlyPrayerTimes(cityId, year);
        
        if (!prayerTimes || prayerTimes.length === 0) {
          console.warn(`[Worker ${workerId}] Şehir ${cityId} için namaz vakitleri alınamadı`);
          results.errorCount++;
          results.errors.push({ cityId, error: 'Veri alınamadı' });
          continue;
        }

        // Storage'ye yükle
        await this.gcsService.uploadPrayerTimes(cityId, year, prayerTimes, cityDetails);
        
        results.successCount++;
        console.log(`[Worker ${workerId}] Şehir ${cityId} için ${prayerTimes.length} günlük veri başarıyla yüklendi`);

        // Rate limiting - API'yi yormamak için worker başına farklı delay
        if (i < cityIds.length - 1) {
          const workerDelay = 500 + (workerId * 50); // Her worker farklı delay
          await delay(workerDelay);
        }

      } catch (error) {
        console.error(`[Worker ${workerId}] Şehir ${cityId} için hata:`, error.message);
        results.errorCount++;
        results.errors.push({ cityId, error: error.message });
        
        // Rate limiting hatası ise biraz daha bekle
        if (error.message.includes('429') || error.message.includes('rate')) {
          console.log(`[Worker ${workerId}] Rate limit hatası, ${3000 + (workerId * 200)}ms bekleniyor...`);
          await delay(3000 + (workerId * 200));
        }
      }
    }

    console.log(`[Worker ${workerId}] Tamamlandı - Başarılı: ${results.successCount}, Hatalı: ${results.errorCount}`);
    return results;
  }

  /**
   * Tüm şehirler için namaz vakitlerini paralel olarak al
   * @param {number} year - Alınacak yıl
   * @param {Array} cityIds - Şehir ID'leri (opsiyonel, belirtilmezse tüm şehirler)
   */
  async fetchPrayerTimesForAllCities(year, cityIds = null) {
    try {
      console.log(`=== ${year} YILI NAMAZ VAKİTLERİ ALMA İŞLEMİ BAŞLADI (${this.PARALLEL_WORKERS} PARALEL KOL) ===`);
      
      // Şehir ID'lerini al
      const targetCityIds = cityIds || await this.cityService.getAllCityIds();
      console.log(`Toplam ${targetCityIds.length} şehir için namaz vakitleri alınacak`);

      // Şehirleri gruplara böl
      const cityGroups = this.divideIntoGroups(targetCityIds, this.PARALLEL_WORKERS);
      console.log(`Şehirler ${cityGroups.length} gruba bölündü:`);
      cityGroups.forEach((group, index) => {
        console.log(`- Grup ${index + 1}: ${group.length} şehir`);
      });

      console.log('\n=== PARALEL İNDİRME BAŞLADI ===');
      const startTime = Date.now();

      // Tüm grupları paralel olarak işle
      const workerPromises = cityGroups.map((group, index) => 
        this.fetchPrayerTimesForGroup(group, year, index + 1)
      );

      // Tüm worker'ların tamamlanmasını bekle
      const workerResults = await Promise.all(workerPromises);

      const endTime = Date.now();
      const totalTime = Math.round((endTime - startTime) / 1000);

      // Sonuçları topla
      const finalResults = {
        totalCities: targetCityIds.length,
        successCount: workerResults.reduce((sum, result) => sum + result.successCount, 0),
        errorCount: workerResults.reduce((sum, result) => sum + result.errorCount, 0),
        errors: workerResults.flatMap(result => result.errors),
        totalTime: totalTime,
        workerResults: workerResults
      };

      // Özet rapor
      console.log('\n=== PARALEL İNDİRME TAMAMLANDI ===');
      console.log(`Toplam süre: ${totalTime} saniye`);
      console.log(`Başarılı: ${finalResults.successCount}`);
      console.log(`Hatalı: ${finalResults.errorCount}`);
      console.log(`Toplam: ${finalResults.totalCities}`);
      console.log(`Ortalama hız: ${Math.round(finalResults.totalCities / totalTime)} şehir/saniye`);
      
      console.log('\nWorker Detayları:');
      workerResults.forEach(result => {
        console.log(`- Worker ${result.workerId}: ${result.successCount}/${result.totalCities} başarılı`);
      });

      if (finalResults.errors.length > 0) {
        console.log('\nHatalı şehirler:');
        finalResults.errors.forEach(err => {
          console.log(`- Şehir ${err.cityId}: ${err.error}`);
        });
      }

      // Özet dosyasını yükle
      await this.uploadSummary(year, {
        ...finalResults,
        completedAt: new Date().toISOString(),
        parallelWorkers: this.PARALLEL_WORKERS
      });

      return {
        success: true,
        ...finalResults
      };

    } catch (error) {
      console.error('Genel hata:', error.message);
      throw error;
    }
  }

  /**
   * Sadece Türkiye şehirleri için namaz vakitlerini al
   * @param {number} year - Alınacak yıl
   */
  async fetchPrayerTimesForTurkey(year) {
    console.log('Sadece Türkiye şehirleri için namaz vakitleri alınıyor...');
    const turkishCityIds = await this.cityService.getTurkishCityIds();
    return await this.fetchPrayerTimesForAllCities(year, turkishCityIds);
  }

  /**
   * Gelecek yıl için namaz vakitlerini al (otomatik cron job için)
   */
  async fetchNextYearPrayerTimes() {
    const nextYear = new Date().getFullYear() + 1;
    console.log(`${nextYear} yılı için namaz vakitleri alınıyor (otomatik)...`);
    return await this.fetchPrayerTimesForAllCities(nextYear);
  }

  /**
   * Özet raporu yükle
   * @param {number} year - Yıl
   * @param {Object} summary - Özet bilgileri
   */
  async uploadSummary(year, summary) {
    try {
      const fileName = `summary-${year}.json`;
      await this.gcsService.uploadFile(fileName, summary, {
        description: `${year} yılı için namaz vakitleri alma özeti (${summary.parallelWorkers} paralel worker)`,
        year: year.toString(),
        type: 'summary',
        parallelWorkers: summary.parallelWorkers.toString()
      });
      console.log(`Özet raporu yüklendi: ${fileName}`);
    } catch (error) {
      console.error('Özet raporu yüklenirken hata:', error.message);
    }
  }

  /**
   * Belirli bir şehir için test (Storage yükleme dahil)
   * @param {number} cityId - Test edilecek şehir ID'si
   * @param {number} year - Yıl
   */
  async testSingleCity(cityId, year = new Date().getFullYear()) {
    console.log(`Test: Şehir ${cityId} için ${year} yılı namaz vakitleri alınıyor...`);
    
    try {
      const cityDetails = await this.cityService.getCityDetails(cityId);
      console.log(`Şehir: ${cityDetails?.fullName || cityId}`);

      // Dosya zaten var mı kontrol et
      const fileName = this.gcsService.generatePrayerTimeFileName(cityId, year);
      const fileExists = await this.gcsService.fileExists(fileName);
      
      if (fileExists) {
        console.log(`⚠️  Dosya zaten mevcut: ${fileName}`);
        console.log('Mevcut dosyayı indirip göstereyim...');
        
        try {
          const existingData = await this.gcsService.downloadFile(fileName);
          console.log(`✅ Mevcut dosya: ${existingData.totalDays} günlük veri, ${existingData.generatedAt} tarihinde oluşturulmuş`);
          return existingData;
        } catch (downloadError) {
          console.log('Mevcut dosya okunamadı, yeni veri alınıyor...');
        }
      }

      // API'den namaz vakitlerini al
      const prayerTimes = await this.diyanetApi.getYearlyPrayerTimes(cityId, year);
      console.log(`${prayerTimes.length} günlük veri alındı`);

      // Storage'ye yükle
      const result = await this.gcsService.uploadPrayerTimes(cityId, year, prayerTimes, cityDetails);
      console.log(`✅ Başarıyla yüklendi: ${result.fileName}`);

      return result;

    } catch (error) {
      console.error(`❌ Test hatası:`, error.message);
      throw error;
    }
  }

  /**
   * Paralel worker sayısını ayarla
   * @param {number} workerCount - Worker sayısı
   */
  setParallelWorkers(workerCount) {
    this.PARALLEL_WORKERS = Math.max(1, Math.min(50, workerCount)); // 1-50 arası sınırla
    console.log(`Paralel worker sayısı: ${this.PARALLEL_WORKERS}`);
  }

  /**
   * Mevcut paralel worker sayısını al
   */
  getParallelWorkers() {
    return this.PARALLEL_WORKERS;
  }
}

// Ana çalıştırma fonksiyonu
async function main() {
  try {
    const fetcher = new PrayerTimesFetcher();
    
    // Komut satırı argümanlarını kontrol et
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (command === 'test') {
      // Test modu
      const cityId = parseInt(args[1]) || 34; // Varsayılan İstanbul
      const year = parseInt(args[2]) || new Date().getFullYear();
      await fetcher.testSingleCity(cityId, year);
      
    } else if (command === 'turkey') {
      // Sadece Türkiye
      const year = parseInt(args[1]) || new Date().getFullYear();
      await fetcher.fetchPrayerTimesForTurkey(year);
      
         } else if (command === 'workers') {
       // Worker sayısını ayarla
       const workerCount = parseInt(args[1]) || 20;
       fetcher.setParallelWorkers(workerCount);
       const year = parseInt(args[2]) || new Date().getFullYear();
       const turkeyOnly = args[3] === 'turkey';
       
       if (turkeyOnly) {
         await fetcher.fetchPrayerTimesForTurkey(year);
       } else {
         await fetcher.fetchPrayerTimesForAllCities(year);
       }
      
    } else if (command === 'next-year') {
      // Gelecek yıl (cron job için)
      await fetcher.fetchNextYearPrayerTimes();
      
    } else {
      // Varsayılan: tüm şehirler
      const year = parseInt(args[0]) || new Date().getFullYear();
      await fetcher.fetchPrayerTimesForAllCities(year);
    }
    
    console.log('\n🎉 İşlem başarıyla tamamlandı!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n💥 Kritik hata:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Eğer bu dosya doğrudan çalıştırılıyorsa main fonksiyonunu çağır
if (require.main === module) {
  main();
}

module.exports = PrayerTimesFetcher; 