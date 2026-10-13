import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from './config';

export type StoredObject = { stream: Readable; contentLength?: number };

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  remove(keys: string[]): Promise<void>;
}

// Keys: "<tenant_id>/<asset_id>.jpg" (main) and "<tenant_id>/<asset_id>.og.jpg" (OG variant).
// The DB CHECK on media_assets.storage_key enforces the tenant prefix.
export const mainKey = (tenantId: string, assetId: string) => `${tenantId}/${assetId}.jpg`;
export const ogKey = (key: string) => key.replace(/\.jpg$/, '.og.jpg');
export const variantKeys = (key: string) => [key, ogKey(key)];

function s3Storage(): Storage {
  const Bucket = env.S3_BUCKET;
  if (!Bucket || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    async put(Key, Body, ContentType) {
      await s3.send(new PutObjectCommand({
        Bucket, Key, Body, ContentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    },
    async get(Key) {
      try {        const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
        return { stream: r.Body as Readable, contentLength: r.ContentLength };
      } catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async remove(keys) {
      if (!keys.length) return;
      await s3.send(new DeleteObjectsCommand({
        Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
    },
  };
}

function diskStorage(): Storage {
  const root = path.resolve(env.LOCAL_STORAGE_DIR);
  const abs = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('bad storage key');
    return p;
  };

  return {
    async put(key, body) {
      const p = abs(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      const p = abs(key);
      try {
        const s = await stat(p);
        return { stream: createReadStream(p), contentLength: s.size };
      } catch { return null; }
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(abs(k), { force: true })));
    },
  };
}

export const storage: Storage = env.STORAGE_DRIVER === 's3' ? s3Storage() : diskStorage();