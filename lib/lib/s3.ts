import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

let s3ClientInstance: S3Client | null = null;

const LOCAL_DIR = path.join(process.cwd(), 'data_db');

function ensureLocalDir(subPath?: string) {
  if (!fs.existsSync(LOCAL_DIR)) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
  }
  if (subPath) {
    const fullSubPath = path.join(LOCAL_DIR, subPath);
    const parent = path.dirname(fullSubPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
  }
}

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
      region: process.env.S3_REGION || 'ir-thr-at1',
      forcePathStyle: true, // Required for Iranian S3 providers
    });
  }
  return s3ClientInstance;
}

const BUCKET = process.env.S3_BUCKET || '';

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
  if (!isS3Configured()) {
    // Local fallback
    ensureLocalDir(dbPath);
    const filePath = path.join(LOCAL_DIR, `${dbPath}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const dataStr = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(dataStr);
    } catch (e) {
      console.error(`Local read error for ${dbPath}:`, e);
      return null;
    }
  }

  const key = pathToKey(dbPath);
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
}

export async function setDoc(dbPath: string, data: any): Promise<void> {
  if (!isS3Configured()) {
    // Local fallback
    ensureLocalDir(dbPath);
    const filePath = path.join(LOCAL_DIR, `${dbPath}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return;
    } catch (e) {
      console.error(`Local write error for ${dbPath}:`, e);
      throw e;
    }
  }

  const key = pathToKey(dbPath);
  const jsonStr = JSON.stringify(data, null, 2);
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
}

export async function deleteDoc(dbPath: string): Promise<void> {
  if (!isS3Configured()) {
    // Local fallback
    const filePath = path.join(LOCAL_DIR, `${dbPath}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error(`Local delete error for ${dbPath}:`, e);
      }
    }
    return;
  }

  const key = pathToKey(dbPath);
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
}

export async function listCollection(collectionPath: string): Promise<any[]> {
  if (!isS3Configured()) {
    // Local fallback
    const dirPath = path.join(LOCAL_DIR, collectionPath);
    if (!fs.existsSync(dirPath)) return [];
    try {
      const files = fs.readdirSync(dirPath);
      const docs: any[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(dirPath, file);
          const dataStr = fs.readFileSync(filePath, 'utf8');
          const id = file.replace('.json', '');
          docs.push({ id, ...JSON.parse(dataStr) });
        }
      }
      return docs;
    } catch (e) {
      console.error(`Local listCollection error for ${collectionPath}:`, e);
      return [];
    }
  }

  const prefix = `db/${collectionPath}/`;
  try {
    const client = getS3Client();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
      })
    );

    const contents = response.Contents || [];
    const fetchPromises = contents.map(async (item) => {
      if (!item.Key) return null;
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: BUCKET,
            Key: item.Key,
          })
        );
        if (!res.Body) return null;
        const jsonStr = await streamToString(res.Body);
        return { id: item.Key.replace(prefix, '').replace('.json', ''), ...JSON.parse(jsonStr) };
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
}
