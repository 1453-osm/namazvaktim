const axios = require('axios');
const config = require('../config/config');

class DiyanetApiService {
  constructor() {
    this.baseUrl = config.diyanet.baseUrl;
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Diyanet API'sine giriş yapar
   */
  async login() {
    try {
      console.log('Diyanet API\'sine giriş yapılıyor...');
      
      const response = await axios.post(
        `${this.baseUrl}${config.diyanet.endpoints.login}`,
        {
          Email: config.diyanet.credentials.username,
          Password: config.diyanet.credentials.password
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      // API yanıt yapısı: { data: { accessToken, refreshToken }, success: true }
      if (response.data && response.data.data && response.data.data.accessToken) {
        this.accessToken = response.data.data.accessToken;
        this.refreshToken = response.data.data.refreshToken;
        console.log('Giriş başarılı!');
        return true;
      } else {
        console.error('Beklenen token bulunamadı. Yanıt yapısı:', JSON.stringify(response.data, null, 2));
        throw new Error('Giriş yanıtında token bulunamadı');
      }
    } catch (error) {
      console.error('Giriş hatası:', error.message);
      if (error.response) {
        console.error('HTTP Status:', error.response.status);
        console.error('Hata detayı:', JSON.stringify(error.response.data, null, 2));
        console.error('Response headers:', error.response.headers);
      }
      if (error.request) {
        console.error('İstek gönderildi ama yanıt alınamadı:', error.request);
      }
      throw error;
    }
  }

  /**
   * Access token'ı yeniler
   */
  async refreshAccessToken() {
    try {
      console.log('Token yenileniyor...');
      
      // Önce PUT method'unu dene
      let response;
      try {
        response = await axios.put(
          `${this.baseUrl}${config.diyanet.endpoints.refreshToken}/${this.refreshToken}`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        // PUT başarısız olursa GET method'unu dene
        if (error.response && error.response.status === 405) {
          console.log('PUT method başarısız, GET method deneniyor...');
          response = await axios.get(
            `${this.baseUrl}${config.diyanet.endpoints.refreshToken}/${this.refreshToken}`,
            {
              headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          throw error;
        }
      }

      // API yanıt yapısını kontrol et
      let tokenData = response.data;
      if (response.data && response.data.data) {
        tokenData = response.data.data;
      }

      if (tokenData && tokenData.accessToken) {
        this.accessToken = tokenData.accessToken;
        // Refresh token da güncellenebilir
        if (tokenData.refreshToken) {
          this.refreshToken = tokenData.refreshToken;
        }
        console.log('Token yenilendi!');
        return true;
      } else {
        console.error('Beklenen token bulunamadı. Yanıt yapısı:', JSON.stringify(response.data, null, 2));
        throw new Error('Token yenileme başarısız - beklenen veri bulunamadı');
      }
    } catch (error) {
      console.error('Belirteç yenileme hatası:', error.message);
      if (error.response) {
        console.error('HTTP Durum Kodu:', error.response.status);
        console.error('Hata detayı:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Belirli bir şehir için namaz vakitlerini alır
   * @param {number} cityId - Şehir ID'si
   * @param {string} startDate - Başlangıç tarihi (YYYY-MM-DD)
   * @param {string} endDate - Bitiş tarihi (YYYY-MM-DD)
   * @param {number} retryCount - Yeniden deneme sayısı (iç kullanım)
   */
  async getPrayerTimes(cityId, startDate, endDate, retryCount = 0) {
    try {
      console.log(`Şehir ${cityId} için namaz vakitleri alınıyor: ${startDate} - ${endDate}`);
      
      // Token yoksa giriş yap
      if (!this.accessToken) {
        await this.login();
      }

      const response = await axios.post(
        `${this.baseUrl}${config.diyanet.endpoints.dateRange}`,
        {
          CityId: cityId,
          StartDate: startDate,
          EndDate: endDate
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // API yanıt yapısını kontrol et - { data: [...], success: true }
      let prayerData = response.data;
      if (response.data && response.data.data) {
        prayerData = response.data.data;
      }
      
      if (prayerData && Array.isArray(prayerData)) {
        console.log(`Şehir ${cityId} için ${prayerData.length} kayıt alındı`);
        return prayerData;
      } else {
        console.error('Beklenmeyen veri yapısı:', response.data);
        throw new Error('Namaz vakitleri alınamadı');
      }
    } catch (error) {
      // Sonsuz döngü koruması
      if (retryCount >= 3) {
        console.error(`Şehir ${cityId} için maksimum deneme sayısına ulaşıldı (${retryCount})`);
        throw error;
      }

      // 401 hatası durumunda token yenile ve tekrar dene
      if (error.response && error.response.status === 401) {
        console.log('Token süresi dolmuş, yenileniyor...');
        try {
          await this.refreshAccessToken();
          return this.getPrayerTimes(cityId, startDate, endDate, retryCount + 1);
        } catch (refreshError) {
          console.error('Token yenileme başarısız:', refreshError.message);
          // Token yenileme başarısız olursa tekrar giriş yap
          console.log('Yeniden giriş yapılıyor...');
          await this.login();
          return this.getPrayerTimes(cityId, startDate, endDate, retryCount + 1);
        }
      }
      
      console.error(`Şehir ${cityId} için hata:`, error.message);
      if (error.response) {
        console.error(`HTTP Durum Kodu: ${error.response.status}`);
      }
      throw error;
    }
  }

  /**
   * Bir yıl boyunca namaz vakitlerini alır
   * @param {number} cityId - Şehir ID'si
   * @param {number} year - Yıl
   */
  async getYearlyPrayerTimes(cityId, year) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    return await this.getPrayerTimes(cityId, startDate, endDate);
  }

  /**
   * Belirli bir şehir için bayram namazı vakitlerini alır
   * @param {number} cityId - Şehir ID'si
   * @param {number} retryCount - Yeniden deneme sayısı (iç kullanım)
   */
  async getEidTimes(cityId, retryCount = 0) {
    try {
      if (!this.accessToken) {
        await this.login();
      }

      const response = await axios.get(
        `${this.baseUrl}${config.diyanet.endpoints.eid}/${cityId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      let eidData = response.data;
      if (response.data && response.data.data) {
        eidData = response.data.data;
      }

      return eidData;
    } catch (error) {
      if (retryCount >= 3) {
        throw error;
      }

      if (error.response && error.response.status === 401) {
        try {
          await this.refreshAccessToken();
          return this.getEidTimes(cityId, retryCount + 1);
        } catch (refreshError) {
          await this.login();
          return this.getEidTimes(cityId, retryCount + 1);
        }
      }

      throw error;
    }
  }

  /**
   * Diyanet API'sinden çıkış yapar (token'ları temizler)
   */
  logout() {
    console.log('Diyanet API oturumu sonlandırılıyor...');
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Mevcut oturum durumunu kontrol eder
   */
  isLoggedIn() {
    return this.accessToken !== null;
  }
}

module.exports = DiyanetApiService; 