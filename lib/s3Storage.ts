import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { INITIAL_PERSONNEL, INITIAL_SETTINGS, INITIAL_REQUESTS } from './mockData';

// Schema for our S3-based JSON document database
export interface AppDatabaseState {
  departments: {
    id: string;
    name: string;
    username?: string;
    password?: string;
  }[];
  deptData: {
    [deptId: string]: {
      personnel: any[];
      requests: any[];
      settings_system: any;
      settings_credentials: any;
      holidays: { [year_month: string]: { days: { [day: number]: string }; monthlyDutyHours: any } };
      firstDayOfWeek: { [year_month: string]: number };
      schedules: { [year_month: string]: any };
    };
  };
}

// Initial state builder
export function getInitialState(): AppDatabaseState {
  return {
    departments: [
      {
        id: 'sepehr',
        name: 'بخش سپهر',
        username: 'headnurse',
        password: '123456',
      }
    ],
    deptData: {
      sepehr: {
        personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
        requests: INITIAL_REQUESTS,
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      }
    }
  };
}

let s3ClientInstance: S3Client | null = null;
const STATE_FILE_KEY = 'hospital-personnel-db.json';

// Get credentials from environment
function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_REGION || 'us-east-1';

  const isConfigured = !!(endpoint && accessKeyId && secretAccessKey && bucketName);

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    region,
    isConfigured
  };
}

// Lazy initializer for S3 Client
export function getS3Client(): { client: S3Client | null; bucket: string; isConfigured: boolean } {
  const config = getS3Config();

  if (!config.isConfigured) {
    return { client: null, bucket: '', isConfigured: false };
  }

  if (!s3ClientInstance) {
    try {
      s3ClientInstance = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId!,
          secretAccessKey: config.secretAccessKey!,
        },
        forcePathStyle: true, // often needed for Iranian Object Storage providers like ArvanCloud/Liara
      });
    } catch (err) {
      console.error('Error initializing S3 Client:', err);
      return { client: null, bucket: '', isConfigured: false };
    }
  }

  return {
    client: s3ClientInstance,
    bucket: config.bucketName!,
    isConfigured: true
  };
}

// In-memory fallback if S3 is not active or during transition
let localMemoryState: AppDatabaseState | null = null;

export async function readState(): Promise<{ state: AppDatabaseState; source: 's3' | 'fallback' | 'memory' }> {
  const { client, bucket, isConfigured } = getS3Client();

  if (!isConfigured || !client) {
    if (!localMemoryState) {
      localMemoryState = getInitialState();
    }
    return { state: localMemoryState, source: 'fallback' };
  }

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: STATE_FILE_KEY,
      })
    );

    if (!response.Body) {
      throw new Error('S3 returned an empty body');
    }

    const dataString = await response.Body.transformToString();
    const state = JSON.parse(dataString) as AppDatabaseState;
    return { state, source: 's3' };
  } catch (err: any) {
    // If the file does not exist yet (NoSuchKey), create it with initial seed
    if (err.name === 'NoSuchKey' || err.code === 'NoSuchKey') {
      console.log('Database state file not found in S3 bucket. Creating a new one with initial seed...');
      const initialState = getInitialState();
      await writeState(initialState);
      return { state: initialState, source: 's3' };
    }

    console.error('Failed to read database state from S3, falling back to local memory:', err);
    if (!localMemoryState) {
      localMemoryState = getInitialState();
    }
    return { state: localMemoryState, source: 'memory' };
  }
}

export async function writeState(state: AppDatabaseState): Promise<boolean> {
  const { client, bucket, isConfigured } = getS3Client();

  // Save to in-memory cache as well
  localMemoryState = state;

  if (!isConfigured || !client) {
    console.log('S3 is not configured. Saved state to local server memory instead.');
    return false;
  }

  try {
    const jsonString = JSON.stringify(state, null, 2);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: STATE_FILE_KEY,
        Body: jsonString,
        ContentType: 'application/json',
      })
    );
    return true;
  } catch (err) {
    console.error('Failed to write database state to S3:', err);
    return false;
  }
}
