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
      activeYear?: number;
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
        activeYear: 1405,
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

export async function readState(): Promise<{ state: AppDatabaseState; source: 's3' | 'fallback' | 'memory' | 'repaired' }> {
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
    let state = JSON.parse(dataString) as AppDatabaseState;
    
    // DEBUG: Write the structure to a file we can read
    const fs = require('fs');
    const debugInfo = {
      departments: state.departments,
      counts: Object.fromEntries(Object.entries(state.deptData || {}).map(([k, v]: [string, any]) => [k, v.personnel?.length || 0]))
    };
    fs.writeFileSync('/home/user/nursingsmart/db_debug.json', JSON.stringify(debugInfo, null, 2));

    let modified = false;

    // Emergency Data Recovery: Look for the richest 'Sepehr' department
    if (state.departments && Array.isArray(state.departments)) {
      const sepehrDepts = state.departments.filter(d => d.name?.trim() === 'بخش سپهر');
      if (sepehrDepts.length > 0) {
        // Find the one with most personnel
        const bestSepehr = sepehrDepts.reduce((prev, current) => {
          const dataPrev = state.deptData?.[prev.id];
          const dataCurr = state.deptData?.[current.id];
          const countPrev = dataPrev?.personnel?.length || 0;
          const countCurr = dataCurr?.personnel?.length || 0;
          return countCurr > countPrev ? current : prev;
        });

        console.log(`Found best Sepehr with ${state.deptData?.[bestSepehr.id]?.personnel?.length} personnel`);

        // If the best one is not 'sepehr' id, or if 'sepehr' id is empty, move it to 'sepehr'
        if (bestSepehr.id !== 'sepehr') {
           const richData = state.deptData[bestSepehr.id];
           state.deptData['sepehr'] = richData;
           // Update departments list to ensure 'sepehr' id points to this rich data
           const deptInList = state.departments.find(d => d.id === 'sepehr');
           if (deptInList) {
             deptInList.name = 'بخش سپهر';
           } else {
             state.departments.push({ id: 'sepehr', name: 'بخش سپهر', username: bestSepehr.username, password: bestSepehr.password });
           }
           modified = true;
        }
      }
    }

    if (modified) {
      await writeState(state);
      return { state, source: 'repaired' };
    }

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
