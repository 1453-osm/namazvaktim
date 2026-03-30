const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const config = require('../config/config');

class GCSService {
  constructor() {
    const region = config.oci.region;
    const namespace = config.oci.namespace;

    this.bucketName = config.oci.bucketName;
    this.namespace = namespace;
    this.region = region;

    // Oracle Object Storage S3-uyumlu endpoint
    const endpoint = `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`;

    this.s3 = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.OCI_ACCESS_KEY || config.oci.accessKey || '',
        secretAccessKey: process.env.OCI_SECRET_KEY || config.oci.secretKey || '',
      },
    });

    // Public URL base
    this.publicUrlBase =
      `https://objectstorage.${region}.oraclecloud.com/n/${namespace}/b/${this.bucketName}/o`;

    console.log(`🔗 Oracle Object Storage: ${this.bucketName} (${region})`);
  }

  /**
   * Dosyanin public URL'ini dondur
   */
  getPublicUrl(fileName) {
    return `${this.publicUrlBase}/${encodeURIComponent(fileName)}`;
  }

  /**
   * Dosya yukleme islemi
   */
  async uploadFile(fileName, data, metadata = {}) {
    try {
      console.log(`Oracle OS'a dosya yukleniyor: ${fileName}`);

      const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: jsonString,
        ContentType: 'application/json',
        Metadata: Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [
            k,
            String(v).replace(/[^\x20-\x7E]/g, ''),
          ])
        ),
      }));

      console.log(`Dosya basariyla yuklendi: ${fileName}`);
      return true;
    } catch (error) {
      console.error(`Dosya yukleme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Dosya indirme islemi
   */
  async downloadFile(fileName) {
    try {
      console.log(`Oracle OS'dan dosya indiriliyor: ${fileName}`);

      const res = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
      }));

      const body = await res.Body.transformToString();
      const data = JSON.parse(body);

      console.log(`Dosya basariyla indirildi: ${fileName}`);
      return data;
    } catch (error) {
      console.error(`Dosya indirme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Dosya var mi kontrol et
   */
  async fileExists(fileName) {
    try {
      await this.s3.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
      }));
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      console.error(`Dosya varlik kontrolu hatasi (${fileName}):`, error.message);
      return false;
    }
  }

  /**
   * Baglanti testi
   */
  async testConnection() {
    try {
      console.log('Oracle OS baglantisi test ediliyor...');

      const testFileName = 'connection-test.json';
      const testData = {
        timestamp: new Date().toISOString(),
        test: 'Oracle Object Storage baglanti testi'
      };

      await this.uploadFile(testFileName, testData, {
        description: 'Baglanti testi',
        type: 'test'
      });

      const downloadedData = await this.downloadFile(testFileName);
      await this.deleteFile(testFileName);

      console.log('✅ Oracle OS baglanti testi basarili');
      return {
        success: true,
        bucket: this.bucketName,
        namespace: this.namespace,
        testData: downloadedData
      };
    } catch (error) {
      console.error('❌ Oracle OS baglanti testi basarisiz:', error.message);
      throw error;
    }
  }

  /**
   * Dosya sil
   */
  async deleteFile(fileName) {
    try {
      console.log(`Oracle OS'dan dosya siliniyor: ${fileName}`);

      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
      }));

      console.log(`Dosya basariyla silindi: ${fileName}`);
      return true;
    } catch (error) {
      console.error(`Dosya silme hatasi (${fileName}):`, error.message);
      throw error;
    }
  }

  /**
   * Bucket'taki dosyalari listele
   */
  async listFiles(prefix = '') {
    try {
      const allFiles = [];
      let continuationToken;

      do {
        const res = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix || undefined,
          ContinuationToken: continuationToken,
        }));

        if (res.Contents) {
          allFiles.push(...res.Contents.map(obj => obj.Key));
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);

      return allFiles;
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
      cityId,
      cityInfo,
      generatedAt: new Date().toISOString(),
      eidAlFitr: {
        hijriDate: eidData.eidAlFitrHijri,
        date: eidData.eidAlFitrDate,
        time: eidData.eidAlFitrTime
      },
      eidAlAdha: {
        hijriDate: eidData.eidAlAdhaHijri,
        date: eidData.eidAlAdhaDate,
        time: eidData.eidAlAdhaTime
      }
    };
    const metadata = {
      description: `${cityInfo.fullName || cityId} bayram namazi vakitleri`,
      uploadedAt: new Date().toISOString(),
      cityId: cityId.toString()
    };
    return await this.uploadFile(fileName, data, metadata);
  }

  async uploadCitiesData(cities) {
    const fileName = 'cities.json';
    const metadata = {
      description: 'Sehir bilgileri',
      uploadedAt: new Date().toISOString()
    };
    return await this.uploadFile(fileName, cities, metadata);
  }

  async uploadPrayerTimes(cityId, year, prayerTimes, cityInfo = {}) {
    const fileName = this.generatePrayerTimeFileName(cityId, year);
    const data = {
      cityId,
      cityInfo,
      year,
      totalDays: prayerTimes.length,
      generatedAt: new Date().toISOString(),
      prayerTimes
    };
    const metadata = {
      description: `${cityInfo.name || cityId} sehri icin ${year} yili namaz vakitleri`,
      uploadedAt: new Date().toISOString(),
      cityId: cityId.toString(),
      year: year.toString()
    };
    return await this.uploadFile(fileName, data, metadata);
  }

  async uploadReligiousDays(year, events = [], extra = {}) {
    const fileName = this.generateReligiousDaysFileName(year);
    const data = {
      year,
      totalEvents: events.length,
      generatedAt: new Date().toISOString(),
      events,
      ...extra
    };
    const metadata = {
      description: `${year} yili dini gunler`,
      uploadedAt: new Date().toISOString(),
      year: year.toString()
    };
    return await this.uploadFile(fileName, data, metadata);
  }
}

module.exports = GCSService;
