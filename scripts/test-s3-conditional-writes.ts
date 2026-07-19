import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client } from '../lib/s3Storage';

function is412(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}

async function expectPreconditionFailure(operation: () => Promise<unknown>, label: string) {
  try {
    await operation();
  } catch (error) {
    if (is412(error)) return;
    throw error;
  }
  throw new Error(`${label}: provider ignored the conditional header; writes are NOT safe`);
}

async function main() {
  const { client, bucket, prefix } = getS3Client();
  const key = `${prefix}/_compatibility-tests/conditional-${randomUUID()}.json`;

  try {
    const first = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '{"revision":1}',
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    if (!first.ETag) throw new Error('Provider returned no ETag');

    await expectPreconditionFailure(() => client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '{"revision":999}',
      IfNoneMatch: '*',
    })), 'If-None-Match test');

    const second = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '{"revision":2}',
      ContentType: 'application/json',
      IfMatch: first.ETag,
    }));
    if (!second.ETag) throw new Error('Provider returned no ETag after If-Match');

    await expectPreconditionFailure(() => client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '{"revision":3}',
      IfMatch: first.ETag,
    })), 'stale If-Match test');

    console.log('PASS: provider enforces If-None-Match and stale If-Match with HTTP 412');
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
