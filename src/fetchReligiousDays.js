const axios = require('axios');
const cheerio = require('cheerio');
const GCSService = require('./services/gcsService');
const config = require('./config/config');

// Hedeflenen dini günler (normalize edilmiş isimler)
const TARGET_EVENTS = [
  'MİRAC KANDİLİ',
  'BERAT KANDİLİ',
  'RAMAZAN BAŞLANGICI',
  'KADİR GECESİ',
  'AREFE',
  'RAMAZAN BAYRAMI (1. GÜN)',
  'RAMAZAN BAYRAMI (2. GÜN)',
  'RAMAZAN BAYRAMI (3. GÜN)',
  'KURBAN BAYRAMI (1. GÜN)',
  'KURBAN BAYRAMI (2. GÜN)',
  'KURBAN BAYRAMI (3. GÜN)',
  'KURBAN BAYRAMI (4. GÜN)',
  'HİCRİ YILBAŞI',
  'AŞURE GÜNÜ',
  'MEVLİD KANDİLİ',
  'ÜÇ AYLARIN BAŞLANGICI',
  'REGAİB KANDİLİ'
].map(normalizeText);

// İçerik.php formatına geçiş yılı ve o yılın içerik ID'si
// Bu değerler Diyanet sitesinin yapısına göre ayarlanmalıdır
// 2026 yılı için içerik ID'si 153, her yıl için 1 artar
const getBaseIcerikConfig = () => {
  const currentYear = new Date().getFullYear();
  // 2026 ve sonrası için içerik.php kullanılıyor
  const BASE_ICERIK_YEAR = 2026;
  const BASE_ICERIK_ID = 153;
  
  // Eğer gelecekte bu değerler değişirse, burada güncellenebilir
  // Örneğin: 2030'dan sonra farklı bir sistem gelirse
  return { BASE_ICERIK_YEAR, BASE_ICERIK_ID };
};

function normalizeText(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .replace(/\./g, '')
    .trim()
    .toLocaleUpperCase('tr-TR');
}

function isTargetEvent(rawName) {
  const normalized = normalizeText(rawName);
  if (normalized.startsWith('AREFE')) {
    return { isTarget: true, canonical: 'AREFE' };
  }
  const found = TARGET_EVENTS.includes(normalized);
  return { isTarget: found, canonical: found ? normalized : null };
}

function detectArefeType(hijriMonthRaw) {
  const month = normalizeText(hijriMonthRaw);
  if (month.includes('RAMAZAN')) return 'ramazan';
  if (month.includes('ZİLHİCCE') || month.includes('ZILHICCE')) return 'kurban';
  return null;
}

function parseMiladiMonthYear(raw, fallbackYear) {
  const cleaned = normalizeText(raw);
  const match = cleaned.match(/([A-ZÇĞİÖŞÜ]+)\s*-?\s*(\d{4})/);
  if (match) {
    return {
      month: match[1],
      year: match[2]
    };
  }
  return { month: cleaned, year: String(fallbackYear || '') };
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: {
      // Bazı sayfalar User-Agent olmadan bakım sayfasına yönleniyor
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    maxRedirects: 5
  });
  return data;
}

function parseTable(html, year, sourceUrl) {
  const $ = cheerio.load(html);
  // İçerik sayfalarında ilk tablo hedef tablo; yoksa hiçbir tablo yoktur
  const table = $('table').first();
  if (!table || table.length === 0) {
    const title = $('title').text();
    throw new Error(`Sayfada tablo bulunamadı (title="${title || '—'}")`);
  }

  const rows = [];
  const fetchedAt = new Date().toISOString();

  table.find('tr').slice(1).each((_, tr) => {
    const tds = $(tr).find('td');
    if (!tds || tds.length < 7) return;

    const cells = tds.map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length < 7) return;

    const [hijriDay, hijriMonth, hijriYear, miladiDay, miladiMonthYearRaw, weekday, rawName] = cells;
    const { isTarget, canonical } = isTargetEvent(rawName);
    if (!isTarget || !canonical) return;

    const { month: miladiMonth, year: miladiYear } = parseMiladiMonthYear(miladiMonthYearRaw, year);
    const arefeType = canonical === 'AREFE' ? detectArefeType(hijriMonth) : null;

    rows.push({
      event: canonical,
      displayName: rawName,
      arefeType,
      hijri: {
        day: hijriDay,
        month: hijriMonth,
        year: hijriYear
      },
      miladi: {
        day: miladiDay,
        month: miladiMonth,
        year: miladiYear
      },
      weekday,
      source: sourceUrl,
      fetchedAt
    });
  });

  return rows;
}

function buildUrlForYear(year) {
  const { BASE_ICERIK_YEAR, BASE_ICERIK_ID } = getBaseIcerikConfig();
  
  // BASE_ICERIK_YEAR ve sonrası için içerik.php formatı kullanılıyor
  // Her yıl için içerik ID'si 1 artar
  if (year >= BASE_ICERIK_YEAR) {
    const icerikId = BASE_ICERIK_ID + (year - BASE_ICERIK_YEAR);
    return `https://vakithesaplama.diyanet.gov.tr/icerik.php?icerik=${icerikId}`;
  }
  // BASE_ICERIK_YEAR öncesi için eski format (dinigunler.php)
  return `https://vakithesaplama.diyanet.gov.tr/dinigunler.php?yil=${year}`;
}

async function fetchYearData(year) {
  const url = buildUrlForYear(year);
  const html = await fetchHtml(url);
  const events = parseTable(html, year, url);
  return { year, events, source: url };
}

async function uploadYearData(gcs, payload) {
  return gcs.uploadReligiousDays(payload.year, payload.events, {
    source: payload.source
  });
}

async function deleteOldYearIfNeeded(gcs) {
  const current = new Date().getFullYear();
  const oldYear = current - 2;
  const oldFile = gcs.generateReligiousDaysFileName(oldYear);
  const exists = await gcs.fileExists(oldFile);
  if (!exists) return false;
  await gcs.deleteFile(oldFile);
  return true;
}

function getManualYears() {
  const current = new Date().getFullYear();
  return [current - 1, current, current + 1, current + 2];
}

async function getAutoYear(gcs) {
  const current = new Date().getFullYear();
  const target = current + 2; // sadece 2 yıl sonrası (gelecek yıl)
  const fileName = gcs.generateReligiousDaysFileName(target);
  const exists = await gcs.fileExists(fileName);
  return exists ? null : target;
}

function parseYearArgs(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map(p => Number(p.trim())).filter(Boolean);
  return parts.length ? parts : null;
}

async function main() {
  const mode = (process.argv[2] || 'manual').toLowerCase();
  const yearsArg = process.argv.find(arg => arg.startsWith('--years='));
  const yearsOverride = yearsArg ? parseYearArgs(yearsArg.split('=')[1]) : null;

  const gcs = new GCSService();
  let years;

  if (mode === 'auto') {
    const targetYear = await getAutoYear(gcs);
    if (!targetYear) {
      console.log('Yeni (gelecek) yıl için eksik veri yok, işlem yapılmadı.');
      // Eski dosya temizliği yine de yapılabilir
      const removed = await deleteOldYearIfNeeded(gcs);
      if (removed) {
        console.log('✅ Eski yıl (2 yıl önce) dosyası silindi.');
      }
      return;
    }
    years = [targetYear];
  } else {
    years = yearsOverride || getManualYears();
  }

  console.log(`İşlenecek yıllar: ${years.join(', ')}`);

  for (const year of years) {
    console.log(`➡️  ${year} yılı çekiliyor...`);
    const payload = await fetchYearData(year);
    console.log(`   ${payload.events.length} kayıt bulundu, yükleniyor...`);
    await uploadYearData(gcs, payload);
    console.log(`✅ ${year} yılı yüklendi.`);
  }

  if (mode === 'auto') {
    const removed = await deleteOldYearIfNeeded(gcs);
    if (removed) {
      console.log('✅ Eski yıl (2 yıl önce) dosyası silindi.');
    } else {
      console.log('ℹ️ Silinecek eski yıl dosyası bulunamadı.');
    }
  }

  console.log('Tamamlandı.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Hata:', err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizeText,
  isTargetEvent,
  detectArefeType,
  parseMiladiMonthYear,
  parseTable,
  buildUrlForYear,
  fetchYearData
};

