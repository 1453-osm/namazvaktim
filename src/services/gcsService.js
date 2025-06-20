const { Storage } = require('@google-cloud/storage');
const config = require('../config/config');
const path = require('path');

class GCSService {
  constructor() {
    // GitHub Actions'da environment variable olarak key geçilebilir
    const storageConfig = {
      projectId: config.gcs.projectId
    };

    // Eğer environment variable varsa onu kullan, yoksa keyFilename kullan
    if (process.env.GCS_SERVICE_ACCOUNT_KEY) {
      try {
        // JSON string'i doğrudan parse et (base64 decode gerekmiyor)
        const keyData = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_KEY);
        storageConfig.credentials = keyData;
        console.log('🔑 GCS Service Account Key environment variable\'dan yüklendi');
      } catch (error) {
        console.error('GCS Service Account Key parse hatası:', error.message);
        console.log('📁 Fallback: Dosyadan key yükleniyor...');
        // Fallback to file
        storageConfig.keyFilename = config.gcs.keyFilename;
      }
    } else {
      // Local development için dosya kullan
      console.log('📁 GCS Service Account Key dosyadan yükleniyor (local development)');
      storageConfig.keyFilename = config.gcs.keyFilename;
    }

    this.storage = new Storage(storageConfig);
    this.bucket = this.storage.bucket(config.gcs.bucketName);
  }

  /**
   * Dosya yükleme işlemi
   * @param {string} fileName - Dosya adı
   * @param {Object} data - Yüklenecek veri
   * @param {Object} metadata - Dosya metadatası
   */
  async uploadFile(fileName, data, metadata = {}) {
    try {
      console.log(`GCS'ye dosya yükleniyor: ${fileName}`);
      
      const file = this.bucket.file(fileName);
      
      // JSON verisini string'e çevir
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      
      // Dosyayı yükle
      await file.save(jsonString, {
        metadata: {
          contentType: 'application/json',
          ...metadata
        },
        resumable: false
      });

      console.log(`Dosya başarıyla yüklendi: ${fileName}`);
      return true;
    } catch (error) {
      console.error(`Dosya yükleme hatası (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Dosya indirme işlemi
   * @param {string} fileName - İndirilecek dosya adı
   */
  async downloadFile(fileName) {
    try {
      console.log(`GCS'den dosya indiriliyor: ${fileName}`);
      
      const file = this.bucket.file(fileName);
      const [contents] = await file.download();
      
      // JSON verisini parse et
      const data = JSON.parse(contents.toString());
      
      console.log(`Dosya başarıyla indirildi: ${fileName}`);
      return data;
    } catch (error) {
      console.error(`Dosya indirme hatası (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Dosya var mı kontrol et
   * @param {string} fileName - Kontrol edilecek dosya adı
   */
  async fileExists(fileName) {
    try {
      const file = this.bucket.file(fileName);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      console.error(`Dosya varlık kontrolü hatası (${fileName}):`, error.message);
      return false;
    }
  }

  /**
   * Dosya sil
   * @param {string} fileName - Silinecek dosya adı
   */
  async deleteFile(fileName) {
    try {
      console.log(`GCS'den dosya siliniyor: ${fileName}`);
      
      const file = this.bucket.file(fileName);
      await file.delete();
      
      console.log(`Dosya başarıyla silindi: ${fileName}`);
      return true;
    } catch (error) {
      console.error(`Dosya silme hatası (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Bucket'taki dosyaları listele
   * @param {string} prefix - Dosya adı ön eki (opsiyonel)
   */
  async listFiles(prefix = '') {
    try {
      const [files] = await this.bucket.getFiles({
        prefix: prefix
      });
      
      return files.map(file => file.name);
    } catch (error) {
      console.error('Dosya listeleme hatası:', error.message);
      throw error;
    }
  }

  /**
   * Namaz vakti dosyası için dosya adı oluştur
   * @param {number} cityId - Şehir ID'si
   * @param {number} year - Yıl
   */
  generatePrayerTimeFileName(cityId, year) {
    return config.prayerTimes.fileNamePattern
      .replace('{cityId}', cityId)
      .replace('{year}', year);
  }

  /**
   * Şehir bilgileri dosyasını yükle
   * @param {Array} cities - Şehir listesi
   */
  async uploadCitiesData(cities) {
    const fileName = 'cities.json';
    const metadata = {
      description: 'Şehir bilgileri',
      uploadedAt: new Date().toISOString()
    };
    
    return await this.uploadFile(fileName, cities, metadata);
  }

  /**
   * Namaz vakti dosyasını yükle
   * @param {number} cityId - Şehir ID'si
   * @param {number} year - Yıl
   * @param {Array} prayerTimes - Namaz vakitleri
   * @param {Object} cityInfo - Şehir bilgileri
   */
  async uploadPrayerTimes(cityId, year, prayerTimes, cityInfo = {}) {
    const fileName = this.generatePrayerTimeFileName(cityId, year);
    
    const data = {
      cityId: cityId,
      cityInfo: cityInfo,
      year: year,
      totalDays: prayerTimes.length,
      generatedAt: new Date().toISOString(),
      prayerTimes: prayerTimes
    };
    
    const metadata = {
      description: `${cityInfo.name || cityId} şehri için ${year} yılı namaz vakitleri`,
      uploadedAt: new Date().toISOString(),
      cityId: cityId.toString(),
      year: year.toString()
    };
    
    return await this.uploadFile(fileName, data, metadata);
  }
}

module.exports = GCSService; 