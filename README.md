# 🕌 Namaz Vakti Backend Servisi (Paralel Sistem)

Diyanet API'sinden namaz vakitlerini **20 paralel worker** ile hızlıca alan ve Google Cloud Storage'a yükleyen otomatik backend servisi.

## 📋 Özellikler

- ⚡ **20 Paralel Worker**: Şehirler 20 gruba bölünerek eş zamanlı işlenir
- 🚀 **Hızlı İndirme**: Tek yoldan 2-3 saat süren işlem 15-20 dakikaya düşer
- ✅ Diyanet API ile entegrasyon
- ✅ Tüm dünya şehirleri desteği (8,552+ şehir)
- ✅ Google Cloud Storage entegrasyonu
- ✅ Otomatik cron job (her yıl 1 Aralık)
- ✅ GitHub Actions ile CI/CD
- ✅ Akıllı rate limiting ve hata yönetimi
- ✅ Manuel tetikleme seçenekleri
- 📊 Detaylı worker performans raporları

## 🚀 Kurulum

### 1. Projeyi Klonlayın

```bash
git clone https://github.com/1453-osm/namazvaktim.git
cd namazvaktim
```

### 2. Bağımlılıkları Yükleyin

```bash
npm install
```

### 3. Environment Dosyasını Oluşturun

```bash
cp .env.example .env
```

`.env` dosyasını düzenleyin:
```env
GCS_BUCKET_NAME=your-bucket-name
NODE_ENV=development
PORT=3000
```

### 4. Google Cloud Service Account

- `namazvaktim-1453-461cbfd17aaf.json` dosyasının proje kök dizininde olduğundan emin olun
- Bu dosya Google Cloud Storage erişimi için gereklidir

## 🎯 Kullanım

### Geliştirme Modunda Çalıştırma

```bash
npm run dev
```

### Production Modunda Çalıştırma

```bash
npm start
```

### Manuel Namaz Vakti Alma (Paralel Sistem)

```bash
# Tüm şehirler için mevcut yıl (20 paralel worker)
node src/fetchPrayerTimes.js

# Belirli yıl için tüm şehirler (20 paralel worker)
node src/fetchPrayerTimes.js 2025

# Sadece Türkiye şehirleri
node src/fetchPrayerTimes.js turkey 2025

# Gelecek yıl için otomatik
node src/fetchPrayerTimes.js next-year

# Worker sayısını özelleştir (5-50 arası)
node src/fetchPrayerTimes.js workers 30 2025

# Worker sayısı + Türkiye modu
node src/fetchPrayerTimes.js workers 15 2025 turkey

# Test (tek şehir)
node src/fetchPrayerTimes.js test 34 2025
```

## 🌐 API Endpoints

| Endpoint | Açıklama |
|----------|----------|
| `GET /` veya `/health` | Sistem durumu kontrolü |
| `GET /stats` | İstatistikler |
| `POST /trigger/all` | Tüm şehirler için manuel tetikleme |
| `POST /trigger/turkey` | Türkiye için manuel tetikleme |

### Örnek Kullanım

```bash
# Sistem durumu
curl http://localhost:3000/health

# İstatistikler
curl http://localhost:3000/stats

# Manuel tetikleme
curl -X POST http://localhost:3000/trigger/turkey
```

## ⏰ GitHub Actions Workflows

Sistem 4 farklı workflow ile çalışır:

### 🔧 1. Manuel - Mevcut Yıl (`fetch-current-year.yml`)
- **Tetikleme**: Manuel
- **Amaç**: İçinde bulunduğumuz yılın verilerini al
- **Seçenekler**: Tüm şehirler / Türkiye / Test

### 🔧 2. Manuel - Gelecek Yıl (`fetch-next-year.yml`)  
- **Tetikleme**: Manuel
- **Amaç**: Gelecek yılın verilerini al
- **Seçenekler**: Tüm şehirler / Türkiye / Test

### 🤖 3. Otomatik - Gelecek Yıl (`auto-fetch-next-year.yml`)
- **Tetikleme**: Her yıl 1 Aralık'tan başlayarak 3 günde bir kontrol
- **Akıllı Kontrol**: Önce Diyanet API'sinde gelecek yıl verisi var mı kontrol eder
- **Tekrar Deneme**: Veri yoksa 3 gün sonra tekrar kontrol eder (31 Aralık'a kadar)
- **Duplicate Kontrol**: GCS'de zaten varsa tekrar indirmez
- **Timeout**: 3 saat (8,552 şehir için)

### 🗑️ 4. Otomatik - Eski Veri Temizleme (`cleanup-old-data.yml`)
- **Tetikleme**: Her yıl 3 Ocak'ta otomatik (manuel de çalıştırılabilir)
- **Amaç**: Önceki yılın verilerini GCS'den siler
- **Güvenlik**: Sadece geçmiş yıl verileri silinir, mevcut/gelecek yıl korunur
- **Dry Run**: Manuel çalıştırmada önce hangi dosyaların silineceğini gösterir
- **Storage Optimizasyonu**: Eski verileri silerek depolama maliyetini düşürür

#### Otomatik Workflow Takvimi:

**📥 Veri Çekme (Aralık):**
```
1 Aralık  → İlk kontrol
4 Aralık  → 2. kontrol  
7 Aralık  → 3. kontrol
10 Aralık → 4. kontrol
...
31 Aralık → Son kontrol
```

**🗑️ Veri Temizleme (Ocak):**
```
3 Ocak → Önceki yıl verilerini sil (örn: 2024 verilerini sil)
```

## 📁 Dosya Yapısı

```
namazvaktim/
├── src/
│   ├── config/
│   │   └── config.js              # Konfigürasyon ayarları
│   │   
│   ├── services/
│   │   ├── diyanetApi.js          # Diyanet API servisi
│   │   ├── gcsService.js          # Google Cloud Storage servisi
│   │   └── cityService.js         # Şehir yönetim servisi
│   ├── fetchPrayerTimes.js        # Ana namaz vakti alma scripti
│   └── index.js                   # Ana uygulama
├── locations/
│   ├── cities.json                # Şehir bilgileri
│   ├── states.json                # Eyalet/İl bilgileri
│   └── countries.json             # Ülke bilgileri
├── .github/workflows/
│   └── fetch-prayer-times.yml     # GitHub Actions workflow
├── namazvaktim-1453-461cbfd17aaf.json  # GCS Service Account
└── package.json
```

## 📊 Veri Formatı

### GCS'deki Dosya Yapısı

```
bucket/
├── prayer-times-{cityId}-{year}.json  # Şehir bazlı namaz vakitleri
├── summary-{year}.json                # Yıllık özet raporu
└── cities.json                        # Şehir bilgileri
```

### Namaz Vakti JSON Örneği

```json
{
  "cityId": 9541,
  "cityInfo": {
    "city": {"id": 9541, "name": "Kadıköy"},
    "state": {"id": 2216, "name": "İstanbul"},
    "country": {"id": 2, "name": "Turkey"},
    "fullName": "Kadıköy, İstanbul, Turkey"
  },
  "year": 2025,
  "totalDays": 365,
  "generatedAt": "2024-12-01T00:00:00.000Z",
  "prayerTimes": [
    {
      "date": "2025-01-01",
      "fajr": "06:42",
      "sunrise": "08:13",
      "dhuhr": "12:48",
      "asr": "15:16",
      "maghrib": "17:22",
      "isha": "18:51"
    }
    // ... 365 gün
  ]
}
```

## 🔧 GitHub Actions

### Secrets Ayarları

Repository secrets olarak eklenmelidir:

#### 1. GCS_SERVICE_ACCOUNT_KEY
```bash
# namazvaktim-1453-461cbfd17aaf.json dosyasını base64'e çevir:
cat namazvaktim-1453-461cbfd17aaf.json | base64 -w 0
# Çıktıyı kopyala ve GitHub secret olarak ekle
```

#### 2. GCS_BUCKET_NAME (Opsiyonel)
- Değer: `namazvaktimdepo`
- Not: Kod içinde zaten varsayılan olarak ayarlanmış

### Manuel Çalıştırma

1. **GitHub reposu > Actions** sayfasına git
2. İstediğin workflow'u seç:
   - **Fetch Current Year Prayer Times**: Mevcut yıl verileri
   - **Fetch Next Year Prayer Times**: Gelecek yıl verileri  
   - **Auto Fetch Next Year Prayer Times**: Otomatik workflow'u manuel tetikle
   - **Cleanup Old Prayer Times Data**: Eski verileri temizle
3. **"Run workflow"** > Parametreleri seç > **"Run workflow"** butonuna bas

#### Workflow Parametreleri:

**Veri Çekme Workflows:**
- **scope**: `all` (tüm şehirler), `turkey` (sadece Türkiye), `test` (tek şehir)
- **test_city_id**: Test için şehir ID'si (varsayılan: 9541 - İstanbul/Kadıköy)

**Temizleme Workflow:**
- **target_year**: Silinecek yıl (boş bırakılırsa önceki yıl otomatik hesaplanır)
- **confirm_delete**: Silme onayı (manuel çalıştırmada `true` yazılmalı)
- **dry_run**: Sadece göster, gerçekte silme (`true`/`false`)

## 🌍 Desteklenen Lokasyonlar

- **Toplam Şehir**: ~47,000
- **Türkiye Şehirleri**: ~1,000
- **Desteklenen Ülkeler**: Tüm dünya

## 🛠️ Geliştirme

### Test Etme

```bash
# Tek şehir test
npm run fetch-prayer-times test 9541

# Geliştirme modunda çalıştır
npm run dev
```

### Loglama

Sistem detaylı log çıktısı verir:
- API istekleri
- GCS yükleme durumu
- Hata mesajları
- İstatistikler

## 📱 Mobil Uygulama Entegrasyonu

Bu backend, mobil uygulamaların doğrudan GCS'den namaz vakitlerini indirmesi için tasarlanmıştır:

```javascript
// Mobil uygulama örnek kullanımı
const prayerTimesUrl = `https://storage.googleapis.com/namazvaktim-data/prayer-times-${cityId}-${year}.json`;
const response = await fetch(prayerTimesUrl);
const prayerData = await response.json();
```

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Branch'i push edin (`git push origin feature/amazing-feature`)
5. Pull Request oluşturun

## 📄 Lisans

Bu proje MIT lisansı altında lisanslanmıştır.

## 📞 İletişim

- GitHub: [1453-osm](https://github.com/1453-osm)
- Email: ozavciosman17@gmail.com

---

⭐ Bu projeyi beğendiyseniz yıldızlamayı unutmayın! 