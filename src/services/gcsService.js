const axios = require('axios');
const config = require('../config/config');

class GCSService {
  constructor() {
    this.baseUrl = config.storage.baseUrl;
    this.storageKey = process.env.STORAGE_KEY || config.storage.key || '';
    this.publicUrl = config.storage.publicUrl;
    console.log(`🔗 Storage API: ${this.baseUrl}`);
  }

  getPublicUrl(fileName) {
    return `${this.publicUrl}/${fileName}`;
  }

  async uploadFile(fileName, data, metadata = {}) {
    try {
      console.log(`Dosya yukleniyor: ${fileName}`);
      const res = await axios.put(
        `${this.baseUrl}/storage/${fileName}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-storage-key': this.storageKey,
          },
          maxBodyLength: Infinity,
        }
      );
      console.log(`Dosya basariyla yuklendi: ${fileName} (${res.data.size} byte)`);
      return true;
    } catch (error) {
      console.error(`Dosya yukleme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  async downloadFile(fileName) {
    try {
      console.log(`Dosya indiriliyor: ${fileName}`);
      const res = await axios.get(`${this.publicUrl}/${fileName}`);
      console.log(`Dosya basariyla indirildi: ${fileName}`);
      return res.data;
    } catch (error) {
      console.error(`Dosya indirme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  async fileExists(fileName) {
    try {
      const res = await axios.head(`${this.publicUrl}/${fileName}`, {
        validateStatus: (s) => s < 500,
      });
      return res.status === 200;
    } catch (error) {
      return false;
    }
  }

  async testConnection() {
    try {
      console.log('Storage baglantisi test ediliyor...');
      const testData = { timestamp: new Date().toISOString(), test: 'baglanti testi' };
      await this.uploadFile('connection-test.json', testData);
      const downloaded = await this.downloadFile('connection-test.json');
      await this.deleteFile('connection-test.json');
      console.log('✅ Storage baglanti testi basarili');
      return { success: true, testData: downloaded };
    } catch (error) {
      console.error('❌ Storage baglanti testi basarisiz:', error.message);
      throw error;
    }
  }

  async deleteFile(fileName) {
    try {
      console.log(`Dosya siliniyor: ${fileName}`);
      await axios.delete(`${this.baseUrl}/storage/${fileName}`, {
        headers: { 'x-storage-key': this.storageKey },
      });
      console.log(`Dosya basariyla silindi: ${fileName}`);
      return true;
    } catch (error) {
      console.error(`Dosya silme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  async listFiles(prefix = '') {
    try {
      const res = await axios.get(`${this.baseUrl}/storage-list`, {
        headers: { 'x-storage-key': this.storageKey },
        params: { prefix },
      });
      return res.data.files || [];
    } catch (error) {
      console.error('Dosya listeleme hatasi:', error.message);
      throw error;
    }
  }

  generatePrayerTimeFileName(cityId, year) {
    return config.prayerTimes.fileNamePattern
      .replace('{cityId}', cityId)
      .replace('{year}', year);
  }

  generateReligiousDaysFileName(year) {
    return config.religiousDays.fileNamePattern
      .replace('{year}', year);
  }

  generateEidTimesFileName(cityId) {
    return config.eidTimes.fileNamePattern
      .replace('{cityId}', cityId);
  }

  async uploadEidTimes(cityId, eidData, cityInfo = {}) {
    const fileName = this.generateEidTimesFileName(cityId);
    const data = {
      cityId, cityInfo,
      generatedAt: new Date().toISOString(),
      eidAlFitr: {
        hijriDate: eidData.eidAlFitrHijri,
        date: eidData.eidAlFitrDate,
        time: eidData.eidAlFitrTime,
      },
      eidAlAdha: {
        hijriDate: eidData.eidAlAdhaHijri,
        date: eidData.eidAlAdhaDate,
        time: eidData.eidAlAdhaTime,
      },
    };
    return await this.uploadFile(fileName, data);
  }

  async uploadCitiesData(cities) {
    return await this.uploadFile('cities.json', cities);
  }

  async uploadPrayerTimes(cityId, year, prayerTimes, cityInfo = {}) {
    const fileName = this.generatePrayerTimeFileName(cityId, year);
    const data = {
      cityId, cityInfo, year,
      totalDays: prayerTimes.length,
      generatedAt: new Date().toISOString(),
      prayerTimes,
    };
    return await this.uploadFile(fileName, data);
  }

  async uploadReligiousDays(year, events = [], extra = {}) {
    const fileName = this.generateReligiousDaysFileName(year);
    const data = {
      year,
      totalEvents: events.length,
      generatedAt: new Date().toISOString(),
      events,
      ...extra,
    };
    return await this.uploadFile(fileName, data);
  }
}

module.exports = GCSService;
