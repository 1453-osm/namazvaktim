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

const BASE_ICERIK_ID = 153; // 2026
const BASE_ICERIK_YEAR = 2026;

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
  const match = cleaned.match(/([A-ZÇĞİÖŞÜ]+)-?(\d{4})/);
  if (match) {
    return {
      month: match[1],
      year: match[2]
    };
  }
  return { month: cleaned, year: String(fallbackYear || '') };
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, { timeout: 20000 });
  return data;
}

function parseTable(html, year, sourceUrl) {
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (!table || table.length === 0) {
    throw new Error('Sayfada tablo bulunamadı');
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
  const nowYear = new Date().getFullYear();
  if (year <= nowYear + 1) {
    return `https://vakithesaplama.diyanet.gov.tr/dinigunler.php?yil=${year}`;
  }

  const icerikId = BASE_ICERIK_ID + (year - BASE_ICERIK_YEAR);
  return `https://vakithesaplama.diyanet.gov.tr/icerik.php?icerik=${icerikId}`;
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

function getManualYears() {
  const current = new Date().getFullYear();
  return [current - 1, current, current + 1, current + 2];
}

async function getAutoYear(gcs) {
  const current = new Date().getFullYear();
  const files = await gcs.listFiles('religious-days-');
  const yearsInBucket = files
    .map(name => {
      const match = name.match(/religious-days-(\d{4})\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter(Boolean);

  const currentExists = yearsInBucket.includes(current);
  if (!currentExists) return current;

  const next = current + 1;
  if (!yearsInBucket.includes(next)) return next;

  return null;
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
      console.log('Yeni yıl bulunamadı veya tüm hedef yıllar mevcut, işlem yapılmadı.');
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

