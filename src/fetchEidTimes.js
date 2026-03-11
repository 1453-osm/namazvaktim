const DiyanetApiService = require('./services/diyanetApi');
const GCSService = require('./services/gcsService');
const CityService = require('./services/cityService');

class EidTimesFetcher {
  constructor() {
    this.diyanetApi = new DiyanetApiService();
    this.gcsService = new GCSService();
    this.cityService = new CityService();
    this.PARALLEL_WORKERS = 20;
  }

  /**
   * Şehir listesini paralel işlem için gruplara böl
   */
  divideIntoGroups(cityIds, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    cityIds.forEach((cityId, index) => {
      groups[index % groupCount].push(cityId);
    });
    return groups.filter(group => group.length > 0);
  }

  /**
   * Mevcut GCS verisini API verisiyle karşılaştır
   * Değişiklik varsa true döner
   */
  hasChanged(existing, fresh) {
    return existing.eidAlFitr.time !== fresh.eidAlFitrTime ||
           existing.eidAlFitr.date !== fresh.eidAlFitrDate ||
           existing.eidAlAdha.time !== fresh.eidAlAdhaTime ||
           existing.eidAlAdha.date !== fresh.eidAlAdhaDate;
  }

  /**
   * Tek bir grup için bayram namazı vakitlerini al
   */
  async fetchEidTimesForGroup(cityIds, workerId) {
    const results = {
      workerId,
      totalCities: cityIds.length,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: []
    };

    console.log(`[Worker ${workerId}] Başlatıldı - ${cityIds.length} şehir işlenecek`);

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < cityIds.length; i++) {
      const cityId = cityIds[i];

      try {
        const cityDetails = await this.cityService.getCityDetails(cityId);
        if (!cityDetails) {
          console.warn(`[Worker ${workerId}] Şehir ${cityId} bulunamadı, atlanıyor...`);
          results.errorCount++;
          results.errors.push({ cityId, error: 'Şehir bulunamadı' });
          continue;
        }

        // API'den bayram namazı vakitlerini al
        const eidData = await this.diyanetApi.getEidTimes(cityId);

        if (!eidData || !eidData.eidAlFitrTime) {
          console.warn(`[Worker ${workerId}] Şehir ${cityId} için bayram verisi alınamadı`);
          results.errorCount++;
          results.errors.push({ cityId, error: 'Veri alınamadı' });
          continue;
        }

        // Mevcut dosya var mı kontrol et
        const fileName = this.gcsService.generateEidTimesFileName(cityId);
        const fileExists = await this.gcsService.fileExists(fileName);

        if (fileExists) {
          // Mevcut veriyi indir ve karşılaştır
          const existing = await this.gcsService.downloadFile(fileName);

          if (!this.hasChanged(existing, eidData)) {
            results.skippedCount++;
            if (i % 50 === 0) {
              console.log(`[Worker ${workerId}] [${i + 1}/${cityIds.length}] ${cityDetails.fullName} - değişiklik yok, atlandı`);
            }
            continue;
          }

          console.log(`[Worker ${workerId}] ${cityDetails.fullName} - veri güncellendi!`);
        } else {
          console.log(`[Worker ${workerId}] ${cityDetails.fullName} - yeni dosya oluşturuluyor`);
        }

        // GCS'ye yükle
        await this.gcsService.uploadEidTimes(cityId, eidData, cityDetails);
        results.updatedCount++;

        // Rate limiting
        if (i < cityIds.length - 1) {
          await delay(500 + (workerId * 50));
        }

      } catch (error) {
        console.error(`[Worker ${workerId}] Şehir ${cityId} için hata:`, error.message);
        results.errorCount++;
        results.errors.push({ cityId, error: error.message });

        if (error.message.includes('429') || error.message.includes('rate')) {
          await delay(3000 + (workerId * 200));
        }
      }
    }

    console.log(`[Worker ${workerId}] Tamamlandı - Güncellenen: ${results.updatedCount}, Atlanan: ${results.skippedCount}, Hatalı: ${results.errorCount}`);
    return results;
  }

  /**
   * Tüm şehirler için bayram namazı vakitlerini paralel olarak al
   */
  async fetchEidTimesForAllCities(cityIds = null) {
    try {
      console.log(`=== BAYRAM NAMAZI VAKİTLERİ ALMA İŞLEMİ BAŞLADI (${this.PARALLEL_WORKERS} PARALEL KOL) ===`);

      const targetCityIds = cityIds || await this.cityService.getAllCityIds();
      console.log(`Toplam ${targetCityIds.length} şehir için bayram namazı vakitleri kontrol edilecek`);

      const cityGroups = this.divideIntoGroups(targetCityIds, this.PARALLEL_WORKERS);
      console.log(`Şehirler ${cityGroups.length} gruba bölündü`);

      const startTime = Date.now();

      const workerPromises = cityGroups.map((group, index) =>
        this.fetchEidTimesForGroup(group, index + 1)
      );

      const workerResults = await Promise.all(workerPromises);

      const totalTime = Math.round((Date.now() - startTime) / 1000);

      const finalResults = {
        totalCities: targetCityIds.length,
        updatedCount: workerResults.reduce((sum, r) => sum + r.updatedCount, 0),
        skippedCount: workerResults.reduce((sum, r) => sum + r.skippedCount, 0),
        errorCount: workerResults.reduce((sum, r) => sum + r.errorCount, 0),
        errors: workerResults.flatMap(r => r.errors),
        totalTime
      };

      console.log('\n=== BAYRAM NAMAZI VAKİTLERİ İŞLEMİ TAMAMLANDI ===');
      console.log(`Toplam süre: ${totalTime} saniye`);
      console.log(`Güncellenen: ${finalResults.updatedCount}`);
      console.log(`Değişiklik yok (atlanan): ${finalResults.skippedCount}`);
      console.log(`Hatalı: ${finalResults.errorCount}`);

      if (finalResults.errors.length > 0) {
        console.log('\nHatalı şehirler:');
        finalResults.errors.forEach(err => {
          console.log(`- Şehir ${err.cityId}: ${err.error}`);
        });
      }

      // Özet yükle
      await this.uploadSummary(finalResults);

      return { success: true, ...finalResults };
    } catch (error) {
      console.error('Genel hata:', error.message);
      throw error;
    }
  }

  /**
   * Sadece Türkiye şehirleri
   */
  async fetchEidTimesForTurkey() {
    console.log('Sadece Türkiye şehirleri için bayram namazı vakitleri alınıyor...');
    const turkishCityIds = await this.cityService.getTurkishCityIds();
    return await this.fetchEidTimesForAllCities(turkishCityIds);
  }

  /**
   * Tek şehir testi
   */
  async testSingleCity(cityId) {
    console.log(`Test: Şehir ${cityId} için bayram namazı vakitleri alınıyor...`);

    const cityDetails = await this.cityService.getCityDetails(cityId);
    console.log(`Şehir: ${cityDetails?.fullName || cityId}`);

    const eidData = await this.diyanetApi.getEidTimes(cityId);
    console.log('API yanıtı:', JSON.stringify(eidData, null, 2));

    const fileName = this.gcsService.generateEidTimesFileName(cityId);
    const fileExists = await this.gcsService.fileExists(fileName);

    if (fileExists) {
      const existing = await this.gcsService.downloadFile(fileName);
      const changed = this.hasChanged(existing, eidData);
      console.log(`Mevcut dosya var. Değişiklik: ${changed ? 'EVET' : 'HAYIR'}`);

      if (!changed) {
        console.log('Veri aynı, güncelleme gerekmiyor.');
        return existing;
      }
    }

    await this.gcsService.uploadEidTimes(cityId, eidData, cityDetails);
    console.log(`Bayram namazı vakitleri yüklendi: ${fileName}`);
    return eidData;
  }

  /**
   * Özet raporu yükle
   */
  async uploadSummary(results) {
    try {
      const fileName = 'eid-times-summary.json';
      await this.gcsService.uploadFile(fileName, {
        ...results,
        completedAt: new Date().toISOString(),
        parallelWorkers: this.PARALLEL_WORKERS
      }, {
        description: 'Bayram namazı vakitleri alma özeti',
        type: 'summary'
      });
      console.log(`Özet raporu yüklendi: ${fileName}`);
    } catch (error) {
      console.error('Özet raporu yüklenirken hata:', error.message);
    }
  }

  setParallelWorkers(workerCount) {
    this.PARALLEL_WORKERS = Math.max(1, Math.min(50, workerCount));
    console.log(`Paralel worker sayısı: ${this.PARALLEL_WORKERS}`);
  }
}

async function main() {
  try {
    const fetcher = new EidTimesFetcher();

    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'test') {
      const cityId = parseInt(args[1]) || 9541;
      await fetcher.testSingleCity(cityId);

    } else if (command === 'turkey') {
      await fetcher.fetchEidTimesForTurkey();

    } else if (command === 'workers') {
      const workerCount = parseInt(args[1]) || 20;
      fetcher.setParallelWorkers(workerCount);
      const turkeyOnly = args[2] === 'turkey';

      if (turkeyOnly) {
        await fetcher.fetchEidTimesForTurkey();
      } else {
        await fetcher.fetchEidTimesForAllCities();
      }

    } else {
      // Varsayılan: tüm şehirler
      await fetcher.fetchEidTimesForAllCities();
    }

    console.log('\n🎉 İşlem başarıyla tamamlandı!');
    process.exit(0);

  } catch (error) {
    console.error('\n💥 Kritik hata:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = EidTimesFetcher;
