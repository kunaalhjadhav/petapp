import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../providers/storage/storage.service';
import { QueueService } from '../../queue/queue.service';
import { PlatformService } from '../platform/platform.service';
import type { MediaAsset } from '../../generated/prisma/client';
import { ALLOWED_MIME, documentSignatureMatches, originalKey, partCount, partLength, partSizeFor, uploadProgress, type MediaVariants } from './media.rules';
import type { CreateUploadDto } from './dto/media.dto';

export interface MediaView {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  status: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  images?: Array<{ width: number; url: string }>;
  hls?: string;
  poster?: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly platform: PlatformService,
  ) {}

  async createUpload(ownerId: string, dto: CreateUploadDto) {
    // Videos are only for posts and reels. Photos are for posts or product listings, so either Reels or the
    // Marketplace allows them. Verification documents need Services or the Marketplace.
    // Private attachments (chat photos, support photos and PDFs) are always allowed: support works whatever is on.
    const on = (f: Parameters<PlatformService['isEnabled']>[0]) => this.platform.isEnabled(f);
    if (dto.private && dto.kind === 'VIDEO') throw new BadRequestException('Videos can’t be sent in messages. Send a photo instead.');
    const enabled = dto.private
      ? true
      : dto.kind === 'DOCUMENT' ? (await on('ENABLE_SERVICES')) || (await on('ENABLE_MARKETPLACE'))
      : dto.kind === 'IMAGE' ? (await on('ENABLE_REELS')) || (await on('ENABLE_MARKETPLACE'))
      : await on('ENABLE_REELS');
    if (!enabled) throw new NotFoundException('This feature isn’t available right now.');
    const mime = dto.mimeType.toLowerCase();
    if (!ALLOWED_MIME[dto.kind].includes(mime)) {
      throw new BadRequestException(`This file type isn’t supported. Use ${ALLOWED_MIME[dto.kind].map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`);
    }
    const maxMb = await this.platform.getSetting<number>(dto.kind === 'IMAGE' ? 'media.maxImageMb' : dto.kind === 'DOCUMENT' ? 'media.maxDocumentMb' : 'media.maxVideoMb');
    if (dto.sizeBytes > maxMb * 1024 * 1024) throw new BadRequestException(`This file is too large. The limit is ${maxMb} MB.`);

    const id = randomUUID();
    const key = originalKey(ownerId, id);
    // Large files the app can send in parts (Phase 9e): a dropped connection only re-sends the part it was on.
    const [resumableAboveMb, partMb] = await Promise.all([this.platform.getSetting<number>('media.resumableAboveMb'), this.platform.getSetting<number>('media.uploadPartMb')]);
    if (dto.resumable && dto.sizeBytes > resumableAboveMb * 1024 * 1024) {
      const partSize = partSizeFor(dto.sizeBytes, partMb * 1024 * 1024);
      const uploadId = await this.storage.createMultipart(key, mime);
      const media = await this.prisma.mediaAsset.create({
        data: { id, ownerId, kind: dto.kind, mimeType: mime, sizeBytes: dto.sizeBytes, storageKey: key, private: dto.kind === 'IMAGE' && dto.private === true, multipartUploadId: uploadId, partSize },
      });
      return {
        media: { id: media.id, kind: media.kind, status: media.status },
        upload: { method: 'MULTIPART', partSize, partCount: partCount(dto.sizeBytes, partSize), expiresInSeconds: 24 * 3600 },
      };
    }
    const url = await this.storage.presignUpload(key, mime, dto.sizeBytes);
    const media = await this.prisma.mediaAsset.create({
      data: { id, ownerId, kind: dto.kind, mimeType: mime, sizeBytes: dto.sizeBytes, storageKey: key, private: dto.kind === 'IMAGE' && dto.private === true },
    });
    return {
      media: { id: media.id, kind: media.kind, status: media.status },
      upload: { url, method: 'PUT', headers: { 'Content-Type': mime }, expiresInSeconds: 900 },
    };
  }

  private async pendingMultipart(ownerId: string, id: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id, ownerId } });
    if (!m) throw new NotFoundException('Upload not found.');
    if (m.status !== 'PENDING_UPLOAD' || !m.multipartUploadId || !m.partSize) throw new BadRequestException('This upload isn’t sent in parts, or has finished.');
    return m as typeof m & { multipartUploadId: string; partSize: number };
  }

  /** Signed addresses for some parts of a resumable upload (each signed with its exact length). */
  async partUrls(ownerId: string, id: string, numbers: number[]) {
    const m = await this.pendingMultipart(ownerId, id);
    const count = partCount(m.sizeBytes, m.partSize);
    const wanted = [...new Set(numbers)].sort((a, b) => a - b);
    const bad = wanted.find((n) => n < 1 || n > count);
    if (bad !== undefined) throw new BadRequestException(`This upload has parts 1 to ${count}.`);
    const parts = await Promise.all(
      wanted.map(async (n) => {
        const length = partLength(m.sizeBytes, m.partSize, n);
        return { partNumber: n, length, url: await this.storage.presignPart(m.storageKey, m.multipartUploadId, n, length), method: 'PUT', headers: { 'Content-Length': String(length) } };
      }),
    );
    return { parts, expiresInSeconds: 900 };
  }

  /** Where a resumable upload got to: which parts storage has, and which are still to send. */
  async uploadStatus(ownerId: string, id: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id, ownerId } });
    if (!m) throw new NotFoundException('Upload not found.');
    if (m.status !== 'PENDING_UPLOAD' || !m.multipartUploadId || !m.partSize) {
      return { mediaId: m.id, status: m.status, method: 'PUT', sizeBytes: m.sizeBytes };
    }
    const have = await this.storage.listParts(m.storageKey, m.multipartUploadId);
    if (!have) throw new BadRequestException('This upload expired. Start it again.');
    return { mediaId: m.id, status: m.status, method: 'MULTIPART', sizeBytes: m.sizeBytes, partSize: m.partSize, ...uploadProgress(m.sizeBytes, m.partSize, have) };
  }

  /** Called by the client after its PUT (or its last part) finishes. Verifies the object, then queues processing. */
  async complete(ownerId: string, id: string): Promise<MediaView> {
    let media = await this.prisma.mediaAsset.findFirst({ where: { id, ownerId } });
    if (!media) throw new NotFoundException('Upload not found.');
    if (media.status !== 'PENDING_UPLOAD') return this.view(media);

    if (media.multipartUploadId && media.partSize) {
      // Join the parts. Every part must be there, at its exact length.
      const have = await this.storage.listParts(media.storageKey, media.multipartUploadId);
      if (!have) throw new BadRequestException('This upload expired. Start it again.');
      const progress = uploadProgress(media.sizeBytes, media.partSize, have);
      if (progress.missing.length) {
        throw new BadRequestException({ message: `Some parts haven’t arrived yet (${progress.missing.slice(0, 10).join(', ')}${progress.missing.length > 10 ? ' …' : ''}). Send them, then finish.`, errors: [{ field: 'parts', code: 'MISSING_PARTS', message: progress.missing.join(',') }] });
      }
      const parts = have.filter((p) => progress.uploaded.includes(p.partNumber)).sort((a, b) => a.partNumber - b.partNumber);
      await this.storage.completeMultipart(media.storageKey, media.multipartUploadId, parts);
      media = await this.prisma.mediaAsset.update({ where: { id }, data: { multipartUploadId: null } });
    }

    const obj = await this.storage.head(media.storageKey);
    if (!obj) throw new BadRequestException('The file hasn’t finished uploading yet. Try again in a moment.');
    if (obj.size !== media.sizeBytes) {
      await this.prisma.mediaAsset.update({ where: { id }, data: { status: 'REJECTED', error: `size mismatch: declared ${media.sizeBytes}, got ${obj.size}` } });
      throw new BadRequestException('The uploaded file doesn’t match what was announced. Please upload it again.');
    }
    if (media.kind === 'DOCUMENT') {
      // Documents stay private and unprocessed; only their signature is checked.
      const head = await this.storage.readHead(media.storageKey, 8);
      const ok = documentSignatureMatches(media.mimeType, head);
      await this.prisma.mediaAsset.updateMany({ where: { id, status: 'PENDING_UPLOAD' }, data: ok ? { status: 'READY' } : { status: 'REJECTED', error: 'file signature does not match its type' } });
      if (!ok) throw new BadRequestException('This file isn’t a valid PDF, JPEG or PNG.');
      return this.get(ownerId, id);
    }
    const updated = await this.prisma.mediaAsset.updateMany({ where: { id, status: 'PENDING_UPLOAD' }, data: { status: 'UPLOADED' } });
    if (updated.count) await this.queue.processMedia(id);
    return this.get(ownerId, id);
  }

  async get(ownerId: string, id: string): Promise<MediaView> {
    const media = await this.prisma.mediaAsset.findFirst({ where: { id, ownerId } });
    if (!media) throw new NotFoundException('Upload not found.');
    return this.view(media);
  }

  /** Client-facing shape. Only processed variants are ever exposed. */
  async view(m: Pick<MediaAsset, 'id' | 'kind' | 'status' | 'width' | 'height' | 'durationMs' | 'variants'> & { private?: boolean }): Promise<MediaView> {
    const v = (m.variants ?? {}) as MediaVariants;
    const base: MediaView = { id: m.id, kind: m.kind, status: m.status, width: m.width, height: m.height, durationMs: m.durationMs };
    if (m.status !== 'READY') return base;
    // Private photos (chat, support) get short-lived signed links; callers check who may see them.
    const url = (key: string) => (m.private ? this.storage.privateMediaUrl(key) : this.storage.url(key));
    return {
      ...base,
      images: v.images ? await Promise.all(v.images.map(async (i) => ({ width: i.width, url: await url(i.key) }))) : undefined,
      hls: v.hls ? await url(v.hls) : undefined,
      poster: v.poster ? await url(v.poster) : undefined,
    };
  }
}
