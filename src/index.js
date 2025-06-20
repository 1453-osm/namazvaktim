const cron = require('node-cron');
const PrayerTimesFetcher = require('./fetchPrayerTimes');
const config = require('./config/config');

class NamazVaktiApp {
  constructor() {
    this.fetcher = new PrayerTimesFetcher();
    this.isRunning = false;
  }

  /**
   * Uygulamayı başlat
   */
  async start() {
    try {
      console.log('🕌 Namaz Vakti Backend Servisi Başlatılıyor...');
      console.log(`Ortam: ${config.app.environment}`);
      console.log(`Port: ${config.app.port}`);
      
      // Cron job'ları planla
      this.scheduleCronJobs();
      
      // Temel HTTP server (health check için)
      this.startHttpServer();
      
      console.log('✅ Servis başarıyla başlatıldı!');
      console.log('📋 Planlanan görevler:');
      console.log('   - Her yıl 1 Aralık 00:00\'da gelecek yılın namaz vakitleri alınacak');
      
    } catch (error) {
      console.error('❌ Servis başlatılırken hata:', error.message);
      process.exit(1);
    }
  }

  /**
   * Cron job'ları planla
   */
  scheduleCronJobs() {
    // Her yıl 1 Aralık saat 00:00'da gelecek yılın namaz vakitlerini al
    cron.schedule('0 0 1 12 *', async () => {
      console.log('\n🔄 Otomatik namaz vakti alma işlemi başlatılıyor...');
      console.log('📅 Tarih:', new Date().toISOString());
      
      if (this.isRunning) {
        console.log('⚠️  Bir işlem zaten devam ediyor, atlanıyor...');
        return;
      }

      try {
        this.isRunning = true;
        await this.fetcher.fetchNextYearPrayerTimes();
        console.log('✅ Otomatik namaz vakti alma işlemi tamamlandı');
      } catch (error) {
        console.error('❌ Otomatik işlem hatası:', error.message);
        // Hata bildirimi burada eklenebilir (email, slack vs.)
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: "Europe/Istanbul"
    });

    // Test amaçlı - her ayın 1'inde saat 09:00'da (geliştirme aşamasında)
    if (config.app.environment === 'development') {
      cron.schedule('0 9 1 * *', async () => {
        console.log('\n🧪 Test: Aylık namaz vakti kontrolü...');
        
        if (this.isRunning) {
          console.log('⚠️  Bir işlem zaten devam ediyor, atlanıyor...');
          return;
        }

        try {
          this.isRunning = true;
          // Test için sadece birkaç şehir al
          const testCityIds = [9541, 9559, 9581]; // İstanbul, Ankara, İzmir
          await this.fetcher.fetchPrayerTimesForAllCities(new Date().getFullYear() + 1, testCityIds);
          console.log('✅ Test işlemi tamamlandı');
        } catch (error) {
          console.error('❌ Test işlemi hatası:', error.message);
        } finally {
          this.isRunning = false;
        }
      }, {
        scheduled: true,
        timezone: "Europe/Istanbul"
      });
    }

    console.log('📅 Cron job\'ları planlandı');
  }

  /**
   * Basit HTTP server başlat (health check, manual trigger için)
   */
  startHttpServer() {
    const http = require('http');
    
    const server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      const url = new URL(req.url, `http://${req.headers.host}`);
      
      switch (url.pathname) {
        case '/':
        case '/health':
          // Health check
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'healthy',
            service: 'Namaz Vakti Backend',
            timestamp: new Date().toISOString(),
            isRunning: this.isRunning,
            environment: config.app.environment
          }));
          break;

        case '/trigger/all':
          // Manuel olarak tüm şehirler için gelecek yıl
          this.handleManualTrigger(res, () => this.fetcher.fetchNextYearPrayerTimes());
          break;

        case '/trigger/turkey':
          // Manuel olarak Türkiye için gelecek yıl
          this.handleManualTrigger(res, () => this.fetcher.fetchPrayerTimesForTurkey(new Date().getFullYear() + 1));
          break;

        case '/stats':
          // İstatistikler
          this.handleStats(res);
          break;

        default:
          res.writeHead(404);
          res.end(JSON.stringify({
            error: 'Endpoint not found',
            availableEndpoints: [
              '/health - Sistem durumu',
              '/trigger/all - Tüm şehirler için manuel tetikleme',
              '/trigger/turkey - Türkiye için manuel tetikleme',
              '/stats - İstatistikler'
            ]
          }));
          break;
      }
    });

    server.listen(config.app.port, () => {
      console.log(`🌐 HTTP server ${config.app.port} portunda çalışıyor`);
      console.log(`📍 Health check: http://localhost:${config.app.port}/health`);
    });
  }

  /**
   * Manuel tetikleme işlemlerini yönet
   * @param {Object} res - HTTP response
   * @param {Function} action - Çalıştırılacak fonksiyon
   */
  async handleManualTrigger(res, action) {
    if (this.isRunning) {
      res.writeHead(409);
      res.end(JSON.stringify({
        error: 'Bir işlem zaten devam ediyor',
        status: 'busy'
      }));
      return;
    }

    res.writeHead(202);
    res.end(JSON.stringify({
      message: 'İşlem başlatıldı',
      status: 'started',
      timestamp: new Date().toISOString()
    }));

    try {
      this.isRunning = true;
      console.log('\n🔧 Manuel tetikleme başlatıldı...');
      const result = await action();
      console.log('✅ Manuel işlem tamamlandı:', result);
    } catch (error) {
      console.error('❌ Manuel işlem hatası:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * İstatistikleri getir
   * @param {Object} res - HTTP response
   */
  async handleStats(res) {
    try {
      const cityStats = await this.fetcher.cityService.getStatistics();
      
      res.writeHead(200);
      res.end(JSON.stringify({
        timestamp: new Date().toISOString(),
        system: {
          isRunning: this.isRunning,
          environment: config.app.environment,
          uptime: process.uptime()
        },
        cities: cityStats,
        nextScheduledRun: '1 Aralık 00:00 (Europe/Istanbul)'
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
  }
}

// Uygulamayı başlat
const app = new NamazVaktiApp();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM alındı, servis kapatılıyor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT alındı, servis kapatılıyor...');
  process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('💥 Beklenmeyen hata:', error);
  process.exit(1);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promise rejection:', reason);
  process.exit(1);
});

// Uygulamayı başlat
app.start().catch(error => {
  console.error('💥 Uygulama başlatılamadı:', error);
  process.exit(1);
});

module.exports = NamazVaktiApp; 