const DiyanetApiService = require('./services/diyanetApi');
const GCSService = require('./services/gcsService');
const CityService = require('./services/cityService');

class PrayerTimesFetcher {
  constructor() {
    this.diyanetApi = new DiyanetApiService();
    this.gcsService = new GCSService();
    this.cityService = new CityService();
  }

  /**
   * Tüm şehirler için namaz vakitlerini al
   * @param {number} year - Alınacak yıl
   * @param {Array} cityIds - Şehir ID'leri (opsiyonel, belirtilmezse tüm şehirler)
   */
  async fetchPrayerTimesForAllCities(year, cityIds = null) {
    try {
      console.log(`=== ${year} YILI NAMAZ VAKİTLERİ ALMA İŞLEMİ BAŞLADI ===`);
      
      // Şehir ID'lerini al
      const targetCityIds = cityIds || await this.cityService.getAllCityIds();
      console.log(`Toplam ${targetCityIds.length} şehir için namaz vakitleri alınacak`);

      // İstatistikler
      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      // Rate limiting için delay function
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // Her şehir için sırayla namaz vakitlerini al
      for (let i = 0; i < targetCityIds.length; i++) {
        const cityId = targetCityIds[i];
        
        try {
          console.log(`\n[${i + 1}/${targetCityIds.length}] Şehir ${cityId} için işlem başlatılıyor...`);
          
          // Şehir detaylarını al
          const cityDetails = await this.cityService.getCityDetails(cityId);
          if (!cityDetails) {
            console.warn(`Şehir ${cityId} bulunamadı, atlanıyor...`);
            errorCount++;
            continue;
          }

          console.log(`Şehir: ${cityDetails.fullName}`);

          // Dosya zaten var mı kontrol et
          const fileName = this.gcsService.generatePrayerTimeFileName(cityId, year);
          const fileExists = await this.gcsService.fileExists(fileName);
          
          if (fileExists) {
            console.log(`Dosya zaten mevcut: ${fileName}, atlanıyor...`);
            successCount++;
            continue;
          }

          // Namaz vakitlerini al
          const prayerTimes = await this.diyanetApi.getYearlyPrayerTimes(cityId, year);
          
          if (!prayerTimes || prayerTimes.length === 0) {
            console.warn(`Şehir ${cityId} için namaz vakitleri alınamadı`);
            errorCount++;
            errors.push({ cityId, error: 'Veri alınamadı' });
            continue;
          }

          // GCS'ye yükle
          await this.gcsService.uploadPrayerTimes(cityId, year, prayerTimes, cityDetails);
          
          successCount++;
          console.log(`Şehir ${cityId} için ${prayerTimes.length} günlük veri başarıyla yüklendi`);

          // Rate limiting - API'yi yormamak için bekle
          if (i < targetCityIds.length - 1) {
            await delay(1000); // 1 saniye bekle
          }

        } catch (error) {
          console.error(`Şehir ${cityId} için hata:`, error.message);
          errorCount++;
          errors.push({ cityId, error: error.message });
          
          // Rate limiting hatası ise biraz daha bekle
          if (error.message.includes('429') || error.message.includes('rate')) {
            console.log('Rate limit hatası, 5 saniye bekleniyor...');
            await delay(5000);
          }
        }
      }

      // Özet rapor
      console.log('\n=== İŞLEM TAMAMLANDI ===');
      console.log(`Başarılı: ${successCount}`);
      console.log(`Hatalı: ${errorCount}`);
      console.log(`Toplam: ${targetCityIds.length}`);
      
      if (errors.length > 0) {
        console.log('\nHatalı şehirler:');
        errors.forEach(err => {
          console.log(`- Şehir ${err.cityId}: ${err.error}`);
        });
      }

      // Özet dosyasını yükle
      await this.uploadSummary(year, {
        totalCities: targetCityIds.length,
        successCount,
        errorCount,
        errors,
        completedAt: new Date().toISOString()
      });

      return {
        success: true,
        totalCities: targetCityIds.length,
        successCount,
        errorCount,
        errors
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
        description: `${year} yılı için namaz vakitleri alma özeti`,
        year: year.toString(),
        type: 'summary'
      });
      console.log(`Özet raporu yüklendi: ${fileName}`);
    } catch (error) {
      console.error('Özet raporu yüklenirken hata:', error.message);
    }
  }

  /**
   * Belirli bir şehir için test (GCS yükleme dahil)
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

      if (prayerTimes.length > 0) {
        console.log('İlk kayıt örneği:', JSON.stringify(prayerTimes[0], null, 2));
        
        // GCS'ye yükle
        console.log('\n🔄 GCS\'ye yükleniyor...');
        await this.gcsService.uploadPrayerTimes(cityId, year, prayerTimes, cityDetails);
        console.log(`✅ Şehir ${cityId} için ${prayerTimes.length} günlük veri başarıyla GCS'ye yüklendi!`);
        console.log(`📁 Dosya adı: ${fileName}`);
      }

      return prayerTimes;
    } catch (error) {
      console.error('Test hatası:', error.message);
      throw error;
    }
  }
}

// CLI kullanımı
async function main() {
  const fetcher = new PrayerTimesFetcher();
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'all':
        // Tüm şehirler için gelecek yıl
        await fetcher.fetchNextYearPrayerTimes();
        break;
        
      case 'turkey':
        // Sadece Türkiye için gelecek yıl
        await fetcher.fetchPrayerTimesForTurkey(new Date().getFullYear() + 1);
        break;
        
      case 'year':
        // Belirli yıl için tüm şehirler
        const year = parseInt(args[1]) || new Date().getFullYear();
        await fetcher.fetchPrayerTimesForAllCities(year);
        break;
        
      case 'test':
        // Test - tek şehir
        const cityId = parseInt(args[1]) || 9541; // Varsayılan: İstanbul/Kadıköy
        const testYear = parseInt(args[2]) || new Date().getFullYear();
        await fetcher.testSingleCity(cityId, testYear);
        break;
        
      default:
        console.log('Kullanım:');
        console.log('  npm run fetch-prayer-times all           # Tüm şehirler için gelecek yıl');
        console.log('  npm run fetch-prayer-times turkey        # Türkiye için gelecek yıl');
        console.log('  npm run fetch-prayer-times year 2024     # Belirli yıl için tüm şehirler');
        console.log('  npm run fetch-prayer-times test 9541     # Test (şehir ID, mevcut yıl)');
        console.log('  npm run fetch-prayer-times test 9541 2025 # Test (şehir ID, belirli yıl)');
        break;
    }
  } catch (error) {
    console.error('İşlem hatası:', error.message);
    process.exit(1);
  }
}

// Eğer bu dosya doğrudan çalıştırılıyorsa
if (require.main === module) {
  main();
}

module.exports = PrayerTimesFetcher; 