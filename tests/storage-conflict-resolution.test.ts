import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StorageConflictError,
  writeResourceResolvingConflict,
  getS3Client,
} from '../lib/s3Storage';
import type { StorageResource } from '../lib/storageSchemas';

// Set up minimal configuration for getS3Config()
process.env.STORAGE_ENV = 'development';
process.env.S3_ENDPOINT = 'https://mock.s3.local';
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY_ID = 'mock-access-key';
process.env.S3_SECRET_ACCESS_KEY = 'mock-secret-key';
process.env.S3_BUCKET_DEVELOPMENT = 'mock-bucket';

const testResource: StorageResource = { type: 'firstDayOfWeek', departmentId: 'dep-1' };

test('writeResourceResolvingConflict: case 1 - initial write succeeds immediately', async () => {
  const { client } = getS3Client();
  let putCount = 0;

  client.send = async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') {
      putCount++;
      assert.equal(command.input.IfMatch, '"etag-v1"');
      return { ETag: '"etag-v2"', VersionId: 'ver-1' };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const result = await writeResourceResolvingConflict(testResource, { '1403_1': 0 }, '"etag-v1"');
  assert.equal(putCount, 1);
  assert.equal(result.etag, '"etag-v2"');
  assert.equal(result.resolvedFromConflict, false);
  assert.equal(result.alreadyApplied, false);
});

test('writeResourceResolvingConflict: case 2 - 412 conflict, but committed document already equals requested data (idempotent)', async () => {
  const { client } = getS3Client();
  let putCount = 0;
  let getCount = 0;

  client.send = async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') {
      putCount++;
      const error: any = new Error('PreconditionFailed');
      error.$metadata = { httpStatusCode: 412 };
      throw error;
    }
    if (command.constructor.name === 'GetObjectCommand') {
      getCount++;
      return {
        ETag: '"etag-committed"',
        Body: {
          transformToString: async () => JSON.stringify({ '1403_1': 0 }),
        },
      };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const result = await writeResourceResolvingConflict(testResource, { '1403_1': 0 }, '"etag-stale"');
  assert.equal(putCount, 1);
  assert.equal(getCount, 1);
  assert.equal(result.etag, '"etag-committed"');
  assert.equal(result.resolvedFromConflict, true);
  assert.equal(result.alreadyApplied, true);
});

test('writeResourceResolvingConflict: case 3 - 412 conflict, committed document differs, retry with freshest ETag succeeds', async () => {
  const { client } = getS3Client();
  let putCount = 0;
  let getCount = 0;

  client.send = async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') {
      putCount++;
      if (putCount === 1) {
        assert.equal(command.input.IfMatch, '"etag-stale"');
        const error: any = new Error('PreconditionFailed');
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      }
      if (putCount === 2) {
        assert.equal(command.input.IfMatch, '"etag-freshest"');
        return { ETag: '"etag-success-retry"', VersionId: 'ver-2' };
      }
    }
    if (command.constructor.name === 'GetObjectCommand') {
      getCount++;
      return {
        ETag: '"etag-freshest"',
        Body: {
          transformToString: async () => JSON.stringify({ '1403_1': 1 }),
        },
      };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const result = await writeResourceResolvingConflict(testResource, { '1403_1': 0 }, '"etag-stale"');
  assert.equal(putCount, 2);
  assert.equal(getCount, 1);
  assert.equal(result.etag, '"etag-success-retry"');
  assert.equal(result.resolvedFromConflict, true);
  assert.equal(result.alreadyApplied, false);
});

test('writeResourceResolvingConflict: case 4 - retry also 412 conflicts, completes write unconditionally (last-writer-wins)', async () => {
  const { client } = getS3Client();
  let putCount = 0;
  let getCount = 0;

  client.send = async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') {
      putCount++;
      if (putCount === 1 || putCount === 2) {
        const error: any = new Error('PreconditionFailed');
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      }
      if (putCount === 3) {
        // Unconditional put check: neither IfMatch nor IfNoneMatch should be set
        assert.equal(command.input.IfMatch, undefined);
        assert.equal(command.input.IfNoneMatch, undefined);
        return { ETag: '"etag-lww"', VersionId: 'ver-3' };
      }
    }
    if (command.constructor.name === 'GetObjectCommand') {
      getCount++;
      return {
        ETag: '"etag-freshest"',
        Body: {
          transformToString: async () => JSON.stringify({ '1403_1': 1 }),
        },
      };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const result = await writeResourceResolvingConflict(testResource, { '1403_1': 0 }, '"etag-stale"');
  assert.equal(putCount, 3);
  assert.equal(getCount, 1);
  assert.equal(result.etag, '"etag-lww"');
  assert.equal(result.resolvedFromConflict, true);
  assert.equal(result.alreadyApplied, false);
});

test('writeResourceResolvingConflict: case 5 - target document deleted after client snapshot fails closed with HTTP 409', async () => {
  const { client } = getS3Client();
  let putCount = 0;

  client.send = async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') {
      putCount++;
      const error: any = new Error('PreconditionFailed');
      error.$metadata = { httpStatusCode: 412 };
      throw error;
    }
    if (command.constructor.name === 'GetObjectCommand') {
      const error: any = new Error('NoSuchKey');
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  await assert.rejects(
    () => writeResourceResolvingConflict(testResource, { '1403_1': 0 }, '"etag-stale"'),
    (err: unknown) => {
      assert.ok(err instanceof StorageConflictError);
      assert.equal((err as StorageConflictError).message, 'Target document no longer exists; it may have been deleted.');
      return true;
    }
  );
  assert.equal(putCount, 1);
});
