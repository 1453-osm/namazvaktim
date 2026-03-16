const axios = require('axios');

// Aladhan hesaplama metodları
const METHODS = {
  1:  'University of Islamic Sciences, Karachi',
  2:  'Islamic Society of North America (ISNA)',
  3:  'Muslim World League',
  4:  'Umm Al-Qura University, Makkah',
  5:  'Egyptian General Authority of Survey',
  7:  'Institute of Geophysics, University of Tehran',
  8:  'Gulf Region',
  9:  'Kuwait',
  10: 'Qatar',
  11: 'Majlis Ugama Islam Singapura',
  12: 'Union Organization Islamic de France',
  14: 'Spiritual Administration of Muslims of Russia',
  15: 'Moonsighting Committee Worldwide',
  16: 'Dubai',
  17: 'Jabatan Kemajuan Islam Malaysia (JAKIM)',
  18: 'Tunisia',
  19: 'Algeria',
  20: 'Kementerian Agama Republik Indonesia (KEMENAG)',
  21: 'Morocco',
  22: 'Comunidade Islamica de Lisboa, Portugal',
  23: 'Ministry of Awqaf, Islamic Affairs and Holy Places, Jordan'
};

// Hariç tutulan metodlar: 0 (Caferi), 6 (mevcut değil), 13 (Diyanet), 99 (Custom)
const EXCLUDED_METHODS = [0, 6, 13, 99];

class AladhanApiService {
  constructor() {
    this.baseUrl = 'https://api.aladhan.com/v1';
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // ms - istekler arası minimum bekleme
  }

  /**
   * Rate limiting için bekleme
   */
  async waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Belirli bir koordinat ve metod için yıllık namaz vakitlerini alır
   * @param {number} lat - Enlem
   * @param {number} lon - Boylam
   * @param {number} method - Hesaplama metodu ID'si
   * @param {number} year - Yıl
   * @param {number} retryCount - Yeniden deneme sayısı
   */
  async getYearlyPrayerTimes(lat, lon, method, year, retryCount = 0) {
    try {
      await this.waitForRateLimit();

      const response = await axios.get(`${this.baseUrl}/calendar/${year}`, {
        params: {
          latitude: lat,
          longitude: lon,
          method: method
        },
        timeout: 30000
      });

      if (response.data && response.data.code === 200 && response.data.data) {
        // Aylık dizileri tek bir düz diziye çevir
        const allDays = [];
        for (const monthData of Object.values(response.data.data)) {
          for (const day of monthData) {
            const h = day.date.hijri;
            allDays.push({
              imsak: this.cleanTime(day.timings.Imsak),
              sunrise: this.cleanTime(day.timings.Sunrise),
              dhuhr: this.cleanTime(day.timings.Dhuhr),
              asr: this.cleanTime(day.timings.Asr),
              maghrib: this.cleanTime(day.timings.Maghrib),
              isha: this.cleanTime(day.timings.Isha),
              hijri: `${parseInt(h.day)}.${h.month.number}.${h.year}`
            });
          }
        }

        return allDays;
      }

      throw new Error(`Beklenmeyen API yanıtı: code=${response.data?.code}`);
    } catch (error) {
      if (retryCount >= 3) {
        throw error;
      }

      // Rate limit veya geçici hata durumunda bekleyip tekrar dene
      if (error.response && (error.response.status === 429 || error.response.status >= 500)) {
        const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff
        console.log(`  Hata ${error.response.status}, ${waitTime}ms beklenip tekrar denenecek...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.getYearlyPrayerTimes(lat, lon, method, year, retryCount + 1);
      }

      // Timeout hatası
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        const waitTime = Math.pow(2, retryCount) * 1000;
        console.log(`  Timeout hatası, ${waitTime}ms beklenip tekrar denenecek...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.getYearlyPrayerTimes(lat, lon, method, year, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Vakit string'inden timezone bilgisini temizler
   * "06:07 (+03)" → "06:07"
   */
  cleanTime(timeStr) {
    if (!timeStr) return null;
    return timeStr.replace(/\s*\(.*\)/, '').trim();
  }

  /**
   * Kullanılacak metodların listesini döndürür
   */
  static getMethods() {
    return { ...METHODS };
  }

  /**
   * Kullanılacak metod ID'lerini döndürür
   */
  static getMethodIds() {
    return Object.keys(METHODS).map(Number);
  }

  /**
   * Metod adını döndürür
   */
  static getMethodName(methodId) {
    return METHODS[methodId] || `Metod ${methodId}`;
  }

  /**
   * İstek istatistiklerini döndürür
   */
  getStats() {
    return {
      totalRequests: this.requestCount
    };
  }
}

module.exports = AladhanApiService;
