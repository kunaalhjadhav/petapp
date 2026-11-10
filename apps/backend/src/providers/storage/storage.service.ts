import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { AppConfig } from '../../config/app-config.service';

/**
 * Object storage over the S3 API (AWS S3, Cloudflare R2, MinIO).
 * Layout:  uploads/{ownerId}/{mediaId}  — originals, private, may contain EXIF/GPS
 *          media/{mediaId}/...          — processed, metadata-stripped, safe to serve via CDN
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  /** Signs URLs that clients will call — may use a different (public) endpoint than server-side calls. */
  private readonly signer: S3Client | null;
  private readonly bucket?: string;
  private readonly publicBase?: string;

  constructor(private readonly config: AppConfig) {
    this.bucket = config.get('S3_BUCKET');
    this.publicBase = config.get('MEDIA_PUBLIC_BASE_URL')?.replace(/\/$/, '');
    const keyId = config.get('S3_ACCESS_KEY_ID');
    const secret = config.get('S3_SECRET_ACCESS_KEY');
    const make = (endpoint?: string) =>
      new S3Client({
        region: config.get('S3_REGION'),
        endpoint,
        forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
        credentials: { accessKeyId: keyId!, secretAccessKey: secret! },
        // Presigned uploads are signed before the file exists: with the SDK's default ("when supported"), the URL
        // carries the checksum of an empty body, which real S3 then refuses (BadDigest). Only when required.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    const ok = Boolean(this.bucket && keyId && secret);
    this.client = ok ? make(config.get('S3_ENDPOINT')) : null;
    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT');
    this.signer = ok ? (publicEndpoint ? make(publicEndpoint) : this.client) : null;
    if (!this.client) this.logger.warn('Object storage is not configured; media uploads are disabled.');
    else if (!this.publicBase) {
      this.logger.warn('MEDIA_PUBLIC_BASE_URL is not set: photos are served by signed URL, but HLS video will not play (its segments can’t be signed). Point it at a CDN or public media/ prefix.');
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  private signerClient(): S3Client {
    this.s3();
    return this.signer!;
  }

  private s3(): S3Client {
    if (!this.client) throw new ServiceUnavailableException('Media storage is not configured.');
    return this.client;
  }

  /** Presigned PUT. Content type and length are part of the signature, so the client can't swap them. */
  presignUpload(key: string, contentType: string, contentLength: number): Promise<string> {
    return getSignedUrl(
      this.signerClient(),
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      { expiresIn: this.config.get('UPLOAD_URL_TTL_SECONDS'), signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  // ── resumable uploads (Phase 9e): S3 multipart. Each part is signed with its exact length. ──

  async createMultipart(key: string, contentType: string): Promise<string> {
    const r = await this.s3().send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!r.UploadId) throw new ServiceUnavailableException('Storage didn’t start the upload. Try again.');
    return r.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number): Promise<string> {
    return getSignedUrl(
      this.signerClient(),
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: contentLength }),
      { expiresIn: this.config.get('UPLOAD_URL_TTL_SECONDS'), signableHeaders: new Set(['content-length']) },
    );
  }

  /** Parts storage has received so far (null when the upload no longer exists). */
  async listParts(key: string, uploadId: string): Promise<Array<{ partNumber: number; etag: string; size: number }> | null> {
    const out: Array<{ partNumber: number; etag: string; size: number }> = [];
    let marker: string | undefined;
    try {
      do {
        const r = await this.s3().send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
        for (const p of r.Parts ?? []) if (p.PartNumber && p.ETag) out.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
        marker = r.IsTruncated ? String(r.NextPartNumberMarker) : undefined;
      } while (marker);
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NoSuchUpload') return null;
      throw e;
    }
    return out;
  }

  async completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    await this.s3().send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.s3().send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const r = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NotFound') return null;
      throw e;
    }
  }

  async download(key: string, toPath: string): Promise<void> {
    const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await pipeline(r.Body as Readable, createWriteStream(toPath));
  }

  async upload(key: string, fromPath: string, contentType: string, cacheControl = 'public, max-age=31536000, immutable'): Promise<void> {
    const { size } = await stat(fromPath);
    await this.s3().send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(fromPath), ContentType: contentType, ContentLength: size, CacheControl: cacheControl }),
    );
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.s3().send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.s3().send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  /** URL a client can load. Processed media only — never call this for uploads/ keys. */
  async url(key: string): Promise<string> {
    if (!key.startsWith('media/')) throw new Error(`Refusing to expose non-public key ${key}`);
    if (this.publicBase) return `${this.publicBase}/${key}`;
    return getSignedUrl(this.signerClient(), new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 3600 });
  }

  /**
   * Short-lived link to a processed private photo (chat and support). Always signed, even with a CDN, and never
   * cached publicly: only people in the conversation are given one.
   */
  async privateMediaUrl(key: string, ttlSeconds = 900): Promise<string> {
    if (!key.startsWith('private/')) throw new Error(`Not a private media key: ${key}`);
    return getSignedUrl(this.signerClient(), new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseCacheControl: 'private, max-age=900' }), { expiresIn: ttlSeconds });
  }

  /** First bytes of an object (file-signature checks). */
  async readHead(key: string, bytes: number): Promise<Buffer> {
    const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  /**
   * Short-lived link to a private original. Only for verification documents, shown to their
   * owner and to reviewers — never cached, never public.
   */
  async privateDocumentUrl(key: string, ttlSeconds = 300): Promise<string> {
    if (!key.startsWith('uploads/')) throw new Error(`Not a private upload: ${key}`);
    return getSignedUrl(this.signerClient(), new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: 'inline' }), { expiresIn: ttlSeconds });
  }

  /** Writes a small private object (data exports). Never cached by a CDN. */
  async putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!key.startsWith('exports/')) throw new Error(`Not a private export key: ${key}`);
    await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length, CacheControl: 'private, no-store' }));
  }

  /** Short-lived download link to someone's own data export, saved under the given file name. */
  async privateExportUrl(key: string, fileName: string, ttlSeconds = 300): Promise<string> {
    if (!key.startsWith('exports/')) throw new Error(`Not a private export key: ${key}`);
    return getSignedUrl(
      this.signerClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`, ResponseCacheControl: 'no-store' }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Reads a whole (small) object. */
  async read(key: string): Promise<Buffer> {
    const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async ping(): Promise<void> {
    await this.s3().send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
  }
}
