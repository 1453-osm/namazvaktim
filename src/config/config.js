require('dotenv').config();

const config = {
  // Diyanet API Configuration
  diyanet: {
    baseUrl: 'https://awqatsalah.diyanet.gov.tr',
    endpoints: {
      login: '/Auth/Login',
      refreshToken: '/Auth/RefreshToken',
      dateRange: '/api/PrayerTime/DateRange',
      eid: '/api/PrayerTime/Eid'
    },
    credentials: {
      username: 'ozavciosman17@gmail.com',
      password: 'cN5+4q%F'
    }
  },

  // Oracle Object Storage Configuration (S3-uyumlu)
  oci: {
    bucketName: process.env.OCI_BUCKET_NAME || 'namazvaktimdepo',
    namespace: process.env.OCI_NAMESPACE || 'ax4vnct8ysku',
    region: process.env.OCI_REGION || 'me-jeddah-1',
    accessKey: process.env.OCI_ACCESS_KEY || '',
    secretKey: process.env.OCI_SECRET_KEY || '',
  },

  // Application Configuration
  app: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development'
  },

  // Prayer Times Configuration
  prayerTimes: {
    // Gelecek yıl için namaz vakitlerini almak
    fetchForNextYear: true,
    // JSON dosya formatı
    outputFormat: 'json',
    // Dosya adı formatı: prayer-times-{cityId}-{year}.json
    fileNamePattern: 'prayer-times-{cityId}-{year}.json'
  },

  // Bayram namazı vakitleri
  eidTimes: {
    outputFormat: 'json',
    fileNamePattern: 'eid-times-{cityId}.json'
  },

  // Dini günler (kandil/bayram) çıktısı
  religiousDays: {
    outputFormat: 'json',
    // Dosya adı formatı: religious-days-{year}.json
    fileNamePattern: 'religious-days-{year}.json'
  }
};

module.exports = config; 