const { Storage } = require('@google-cloud/storage');
const DiyanetApiService = require('./services/diyanetApi');
const AladhanApiService = require('./services/aladhanApi');
const CityService = require('./services/cityService');
const config = require('./config/config');

const NEW_BUCKET = process.env.GCS_NEW_BUCKET || 'nvvakitler';
const DIYANET_WORKERS = 50;
const ALADHAN_WORKERS = 10; // Rate limit nedeniyle düşük tutulmalı

class AllTimesFetcher {
  constructor() {
    this.diyanetApi = new DiyanetApiService();
    this.aladhanApi = new AladhanApiService();
    this.cityService = new CityService();

    // Yeni bucket için GCS bağlantısı
    const storageConfig = { projectId: config.gcs.projectId };
    if (process.env.GCS_SERVICE_ACCOUNT_KEY) {
      try {
        storageConfig.credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_KEY);
      } catch (e) {
        storageConfig.keyFilename = config.gcs.keyFilename;
      }
    } else {
      storageConfig.keyFilename = config.gcs.keyFilename;
    }
    this.storage = new Storage(storageConfig);
    this.bucket = this.storage.bucket(NEW_BUCKET);
  }

  // İki nokta kaldır: "06:50" → "0650"
  compactTime(time) {
    return time ? time.replace(':', '') : '0000';
  }

  // Diyanet verisini kompakt formata çevir: [imsak, güneş, öğle, ikindi, akşam, yatsı, hicri]
  formatDiyanet(rawDays) {
    return rawDays.map(d => [
      this.compactTime(d.fajr),
      this.compactTime(d.sunrise),
      this.compactTime(d.dhuhr),
      this.compactTime(d.asr),
      this.compactTime(d.maghrib),
      this.compactTime(d.isha),
      d.hijriDateShort
    ]);
  }

  // Aladhan verisini kompakt formata çevir: [imsak, güneş, öğle, ikindi, akşam, yatsı, hicri]
  formatAladhan(rawDays) {
    return rawDays.map(d => [
      this.compactTime(d.imsak),
      this.compactTime(d.sunrise),
      this.compactTime(d.dhuhr),
      this.compactTime(d.asr),
      this.compactTime(d.maghrib),
      this.compactTime(d.isha),
      d.hijri
    ]);
  }

  // Yeni bucket'a kompakt JSON yükle
  async upload(method, cityId, year, data) {
    const filePath = `${method}/${cityId}-${year}.json`;
    const file = this.bucket.file(filePath);
    await file.save(JSON.stringify(data), {
      metadata: { contentType: 'application/json' },
      resumable: false
    });
  }

  // Dosya var mı kontrol et
  async exists(method, cityId, year) {
    const filePath = `${method}/${cityId}-${year}.json`;
    const [exists] = await this.bucket.file(filePath).exists();
    return exists;
  }

  // Şehirleri gruplara böl
  divideIntoGroups(items, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    items.forEach((item, index) => {
      groups[index % groupCount].push(item);
    });
    return groups.filter(g => g.length > 0);
  }

  // --- Diyanet (Metod 0) ---

  async fetchDiyanetForGroup(cities, year, workerId) {
    const results = { workerId, success: 0, error: 0, errors: [] };

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      try {
        // Dosya var mı kontrol
        if (await this.exists(0, city.id, year)) {
          results.success++;
          continue;
        }

        const rawData = await this.diyanetApi.getYearlyPrayerTimes(city.id, year);
        if (!rawData || rawData.length === 0) {
          results.error++;
          results.errors.push({ cityId: city.id, error: 'Veri alınamadı' });
          continue;
        }

        const compact = this.formatDiyanet(rawData);
        await this.upload(0, city.id, year, compact);
        results.success++;

        if (results.success % 50 === 0) {
          console.log(`[D-W${workerId}] ${results.success}/${cities.length}`);
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 300 + workerId * 10));
      } catch (error) {
        results.error++;
        results.errors.push({ cityId: city.id, error: error.message });
        if (error.message.includes('429')) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    console.log(`[D-W${workerId}] Tamamlandı: ${results.success}/${cities.length}`);
    return results;
  }

  async fetchDiyanet(year, cities) {
    console.log(`\n=== DİYANET (Metod 0) - ${cities.length} şehir ===`);
    await this.diyanetApi.login();

    const groups = this.divideIntoGroups(cities, DIYANET_WORKERS);
    console.log(`${groups.length} worker başlatılıyor...`);

    const results = await Promise.all(
      groups.map((group, i) => this.fetchDiyanetForGroup(group, year, i + 1))
    );

    this.diyanetApi.logout();
    return this.summarizeResults('Diyanet', results, cities.length);
  }

  // --- Aladhan (Metod 1-23) ---

  async fetchAladhanForGroup(cities, method, year, workerId) {
    const results = { workerId, method, success: 0, error: 0, errors: [] };

    // Worker'lar kademeli başlasın (stagger)
    await new Promise(r => setTimeout(r, workerId * 200));

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      try {
        if (await this.exists(method, city.id, year)) {
          results.success++;
          continue;
        }

        const rawData = await this.aladhanApi.getYearlyPrayerTimes(
          city.lat, city.lon, method, year
        );
        if (!rawData || rawData.length === 0) {
          results.error++;
          results.errors.push({ cityId: city.id, error: 'Veri alınamadı' });
          continue;
        }

        const compact = this.formatAladhan(rawData);
        await this.upload(method, city.id, year, compact);
        results.success++;

        if (results.success % 50 === 0) {
          console.log(`[A${method}-W${workerId}] ${results.success}/${cities.length}`);
        }

        // İstekler arası bekleme
        await new Promise(r => setTimeout(r, 150));
      } catch (error) {
        results.error++;
        results.errors.push({ cityId: city.id, error: error.message });
        if (error.message.includes('429')) {
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }

    console.log(`[A${method}-W${workerId}] Tamamlandı: ${results.success}/${cities.length}`);
    return results;
  }

  async fetchAladhanMethod(method, year, cities) {
    console.log(`\n=== ALADHAN Metod ${method} (${AladhanApiService.getMethodName(method)}) - ${cities.length} şehir ===`);

    const groups = this.divideIntoGroups(cities, ALADHAN_WORKERS);
    console.log(`${groups.length} worker başlatılıyor...`);

    const results = await Promise.all(
      groups.map((group, i) => this.fetchAladhanForGroup(group, method, year, i + 1))
    );

    return this.summarizeResults(`Aladhan M${method}`, results, cities.length);
  }

  async fetchAllAladhan(year, cities) {
    const methodIds = AladhanApiService.getMethodIds();
    console.log(`\n=== ALADHAN - ${methodIds.length} metod x ${cities.length} şehir ===`);

    const allResults = [];
    for (const method of methodIds) {
      const result = await this.fetchAladhanMethod(method, year, cities);
      allResults.push(result);
    }
    return allResults;
  }

  // --- Sonuç Özeti ---

  summarizeResults(label, workerResults, totalCities) {
    const success = workerResults.reduce((s, r) => s + r.success, 0);
    const error = workerResults.reduce((s, r) => s + r.error, 0);
    const errors = workerResults.flatMap(r => r.errors);

    console.log(`\n[${label}] Sonuç: ${success} başarılı, ${error} hatalı / ${totalCities} toplam`);
    if (errors.length > 0) {
      console.log(`[${label}] İlk 5 hata:`);
      errors.slice(0, 5).forEach(e => console.log(`  - Şehir ${e.cityId}: ${e.error}`));
    }

    return { label, success, error, totalCities, errors };
  }

  // --- Genel ---

  async fetchAll(year, cities) {
    const startTime = Date.now();

    // Önce Diyanet
    await this.fetchDiyanet(year, cities);

    // Sonra Aladhan metodları sırayla
    await this.fetchAllAladhan(year, cities);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== TAMAMLANDI - Toplam süre: ${Math.floor(elapsed / 60)}dk ${elapsed % 60}sn ===`);
  }

  // Test: tek şehir, tüm metodlar
  async testCity(cityId, year) {
    const city = await this.cityService.getCityById(cityId);
    if (!city) {
      console.error(`Şehir ${cityId} bulunamadı`);
      return;
    }
    console.log(`Test: ${city.name} (${city.id}) - lat:${city.lat} lon:${city.lon}`);

    // Diyanet
    console.log('\n--- Diyanet (Metod 0) ---');
    await this.diyanetApi.login();
    const diyanetRaw = await this.diyanetApi.getYearlyPrayerTimes(cityId, year);
    const diyanetCompact = this.formatDiyanet(diyanetRaw);
    console.log(`${diyanetCompact.length} gün, örnek:`, diyanetCompact[0]);
    await this.upload(0, cityId, year, diyanetCompact);
    console.log(`Yüklendi: 0/${cityId}-${year}.json`);
    this.diyanetApi.logout();

    // Aladhan - tüm metodlar
    const methodIds = AladhanApiService.getMethodIds();
    for (const method of methodIds) {
      console.log(`\n--- Aladhan Metod ${method} (${AladhanApiService.getMethodName(method)}) ---`);
      const aladhanRaw = await this.aladhanApi.getYearlyPrayerTimes(city.lat, city.lon, method, year);
      const aladhanCompact = this.formatAladhan(aladhanRaw);
      console.log(`${aladhanCompact.length} gün, örnek:`, aladhanCompact[0]);
      await this.upload(method, cityId, year, aladhanCompact);
      console.log(`Yüklendi: ${method}/${cityId}-${year}.json`);
    }

    console.log('\nTest tamamlandı!');
  }
}

// CLI
async function main() {
  const fetcher = new AllTimesFetcher();
  const args = process.argv.slice(2);
  const command = args[0];
  const year = parseInt(args[args.length - 1]) || new Date().getFullYear();

  await fetcher.cityService.ensureDataLoaded();

  if (command === 'test') {
    const cityId = parseInt(args[1]) || 9541;
    await fetcher.testCity(cityId, year);

  } else if (command === 'diyanet') {
    const cities = await fetcher.cityService.getAllCities();
    await fetcher.fetchDiyanet(year, cities);

  } else if (command === 'aladhan') {
    const cities = await fetcher.cityService.getAllCities();
    const methodId = parseInt(args[1]);
    if (methodId && AladhanApiService.getMethodIds().includes(methodId)) {
      await fetcher.fetchAladhanMethod(methodId, year, cities);
    } else {
      await fetcher.fetchAllAladhan(year, cities);
    }

  } else if (command === 'all') {
    const cities = await fetcher.cityService.getAllCities();
    await fetcher.fetchAll(year, cities);

  } else {
    console.log('Kullanım:');
    console.log('  node src/fetchAllTimes.js test <cityId> [year]     - Tek şehir testi');
    console.log('  node src/fetchAllTimes.js diyanet [year]           - Diyanet (metod 0)');
    console.log('  node src/fetchAllTimes.js aladhan [year]           - Tüm Aladhan metodları');
    console.log('  node src/fetchAllTimes.js aladhan <methodId> [year] - Tek Aladhan metodu');
    console.log('  node src/fetchAllTimes.js all [year]               - Hepsi');
    console.log('\nMetodlar:', AladhanApiService.getMethodIds().join(', '));
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Kritik hata:', err.message);
    process.exit(1);
  });
}

module.exports = AllTimesFetcher;
