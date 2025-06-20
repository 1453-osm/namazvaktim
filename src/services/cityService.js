const fs = require('fs').promises;
const path = require('path');

class CityService {
  constructor() {
    this.citiesPath = path.join(__dirname, '../../locations/cities.json');
    this.statesPath = path.join(__dirname, '../../locations/states.json');
    this.countriesPath = path.join(__dirname, '../../locations/countries.json');
    
    this.cities = null;
    this.states = null;
    this.countries = null;
  }

  /**
   * Tüm verileri yükle
   */
  async loadData() {
    try {
      console.log('Şehir verileri yükleniyor...');
      
      const [citiesData, statesData, countriesData] = await Promise.all([
        fs.readFile(this.citiesPath, 'utf8'),
        fs.readFile(this.statesPath, 'utf8'),
        fs.readFile(this.countriesPath, 'utf8')
      ]);

      this.cities = JSON.parse(citiesData);
      this.states = JSON.parse(statesData);
      this.countries = JSON.parse(countriesData);

      console.log(`Toplam ${this.cities.length} şehir yüklendi`);
      
    } catch (error) {
      console.error('Şehir verileri yüklenirken hata:', error.message);
      throw error;
    }
  }

  /**
   * Veri yüklü değilse yükle
   */
  async ensureDataLoaded() {
    if (!this.cities || !this.states || !this.countries) {
      await this.loadData();
    }
  }

  /**
   * Tüm şehirleri al
   */
  async getAllCities() {
    await this.ensureDataLoaded();
    return this.cities;
  }

  /**
   * Şehir ID'sine göre şehir bilgisi al
   * @param {number} cityId - Şehir ID'si
   */
  async getCityById(cityId) {
    await this.ensureDataLoaded();
    return this.cities.find(city => city.id === cityId);
  }

  /**
   * Şehir ID'sine göre il bilgisi al
   * @param {number} cityId - Şehir ID'si
   */
  async getStateByCity(cityId) {
    await this.ensureDataLoaded();
    const city = await this.getCityById(cityId);
    if (!city) return null;
    
    return this.states.find(state => state.id === city.state_id);
  }

  /**
   * Şehir ID'sine göre ülke bilgisi al
   * @param {number} cityId - Şehir ID'si
   */
  async getCountryByCity(cityId) {
    await this.ensureDataLoaded();
    const state = await this.getStateByCity(cityId);
    if (!state) return null;
    
    return this.countries.find(country => country.id === state.country_id);
  }

  /**
   * Şehir hakkında detaylı bilgi al
   * @param {number} cityId - Şehir ID'si
   */
  async getCityDetails(cityId) {
    await this.ensureDataLoaded();
    
    const city = await this.getCityById(cityId);
    if (!city) return null;

    const state = await this.getStateByCity(cityId);
    const country = await this.getCountryByCity(cityId);

    return {
      city: city,
      state: state,
      country: country,
      fullName: `${city.name}, ${state?.name || ''}, ${country?.name || ''}`
    };
  }

  /**
   * Sadece Türkiye'deki şehirleri al
   */
  async getTurkishCities() {
    await this.ensureDataLoaded();
    
    // Türkiye'nin country_id'si 2
    const turkishStates = this.states.filter(state => state.country_id === 2);
    const turkishStateIds = turkishStates.map(state => state.id);
    
    return this.cities.filter(city => turkishStateIds.includes(city.state_id));
  }

  /**
   * Belirli bir ülkedeki şehirleri al
   * @param {number} countryId - Ülke ID'si
   */
  async getCitiesByCountry(countryId) {
    await this.ensureDataLoaded();
    
    const countryStates = this.states.filter(state => state.country_id === countryId);
    const stateIds = countryStates.map(state => state.id);
    
    return this.cities.filter(city => stateIds.includes(city.state_id));
  }

  /**
   * Şehir ID'lerini al
   */
  async getAllCityIds() {
    await this.ensureDataLoaded();
    return this.cities.map(city => city.id);
  }

  /**
   * Türkiye şehir ID'lerini al
   */
  async getTurkishCityIds() {
    const turkishCities = await this.getTurkishCities();
    return turkishCities.map(city => city.id);
  }

  /**
   * Şehir istatistikleri
   */
  async getStatistics() {
    await this.ensureDataLoaded();
    
    const turkishCities = await this.getTurkishCities();
    
    return {
      totalCities: this.cities.length,
      totalStates: this.states.length,
      totalCountries: this.countries.length,
      turkishCities: turkishCities.length
    };
  }

  /**
   * Şehir adına göre arama
   * @param {string} searchTerm - Arama terimi
   */
  async searchCities(searchTerm) {
    await this.ensureDataLoaded();
    
    const term = searchTerm.toLowerCase();
    return this.cities.filter(city => 
      city.name.toLowerCase().includes(term) ||
      city.code.toLowerCase().includes(term)
    );
  }
}

module.exports = CityService; 