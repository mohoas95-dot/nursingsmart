import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

let s3ClientInstance: S3Client | null = null;

export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY &&
    process.env.S3_SECRET_KEY &&
    process.env.S3_BUCKET
  );
}

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: true, // Required for many Iranian providers (ArvanCloud, Liara, ParsPack)
    });
  }
  return s3ClientInstance;
}

const BUCKET = process.env.S3_BUCKET || '';

// Local fallback storage config
const LOCAL_STORAGE_DIR = path.join(process.cwd(), '.local_storage');

function ensureLocalDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Convert Firestore-style collection paths to safe local or S3 paths
function pathToKey(dbPath: string): string {
  return `db/${dbPath}.json`;
}

async function streamToString(stream: any): Promise<string> {
  if (typeof stream.transformToString === 'function') {
    return await stream.transformToString();
  }
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export async function getDoc(dbPath: string): Promise<any> {
  const key = pathToKey(dbPath);

  if (isS3Configured()) {
    try {
      const client = getS3Client();
      const response = await client.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: key,
        })
      );
      if (!response.Body) return null;
      const jsonStr = await streamToString(response.Body);
      return JSON.parse(jsonStr);
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      console.error(`S3 getDoc error for ${key}:`, err);
      throw err;
    }
  } else {
    // Local fallback
    const localPath = path.join(LOCAL_STORAGE_DIR, key);
    if (!fs.existsSync(localPath)) return null;
    try {
      const jsonStr = fs.readFileSync(localPath, 'utf8');
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error(`Local getDoc error for ${key}:`, err);
      return null;
    }
  }
}

export async function setDoc(dbPath: string, data: any): Promise<void> {
  const key = pathToKey(dbPath);
  const jsonStr = JSON.stringify(data, null, 2);

  if (isS3Configured()) {
    try {
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: jsonStr,
          ContentType: 'application/json',
        })
      );
    } catch (err) {
      console.error(`S3 setDoc error for ${key}:`, err);
      throw err;
    }
  } else {
    // Local fallback
    const localPath = path.join(LOCAL_STORAGE_DIR, key);
    ensureLocalDirForFile(localPath);
    try {
      fs.writeFileSync(localPath, jsonStr, 'utf8');
    } catch (err) {
      console.error(`Local setDoc error for ${key}:`, err);
      throw err;
    }
  }
}

export async function deleteDoc(dbPath: string): Promise<void> {
  const key = pathToKey(dbPath);

  if (isS3Configured()) {
    try {
      const client = getS3Client();
      await client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: key,
        })
      );
    } catch (err) {
      console.error(`S3 deleteDoc error for ${key}:`, err);
      throw err;
    }
  } else {
    // Local fallback
    const localPath = path.join(LOCAL_STORAGE_DIR, key);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (err) {
        console.error(`Local deleteDoc error for ${key}:`, err);
        throw err;
      }
    }
  }
}

// Lists all documents directly inside a collection path
export async function listCollection(collectionPath: string): Promise<any[]> {
  const prefix = `db/${collectionPath}/`;

  if (isS3Configured()) {
    try {
      const client = getS3Client();
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          Delimiter: '/',
        })
      );

      const contents = response.Contents || [];
      const fetchPromises = contents.map(async (item) => {
        if (!item.Key) return null;
        // Make sure it is directly under this path (not a deeper subcollection)
        const subKey = item.Key.substring(prefix.length);
        if (subKey.includes('/')) return null;

        try {
          const res = await client.send(
            new GetObjectCommand({
              Bucket: BUCKET,
              Key: item.Key,
            })
          );
          if (!res.Body) return null;
          const jsonStr = await streamToString(res.Body);
          return JSON.parse(jsonStr);
        } catch (e) {
          console.error(`Error loading object ${item.Key}:`, e);
          return null;
        }
      });

      const docs = await Promise.all(fetchPromises);
      return docs.filter((d) => d !== null);
    } catch (err) {
      console.error(`S3 listCollection error for ${collectionPath}:`, err);
      throw err;
    }
  } else {
    // Local fallback
    const localCollectionDir = path.join(LOCAL_STORAGE_DIR, 'db', collectionPath);
    if (!fs.existsSync(localCollectionDir)) return [];

    try {
      const files = fs.readdirSync(localCollectionDir);
      const docs = files
        .filter((f) => f.endsWith('.json'))
        .map((file) => {
          const filePath = path.join(localCollectionDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
          } catch (e) {
            console.error(`Error reading local file ${filePath}:`, e);
            return null;
          }
        });
      return docs.filter((d) => d !== null);
    } catch (err) {
      console.error(`Local listCollection error for ${collectionPath}:`, err);
      return [];
    }
  }
}
