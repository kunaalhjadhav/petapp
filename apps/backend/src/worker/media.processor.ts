import { Injectable, Logger } from '@nestjs/common';
import { mkdtemp, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import sharp from 'sharp';

// sharp 0.35's typings don't expose the namespace to CommonJS builds, so derive the types from the function.
type Sharp = ReturnType<typeof sharp>;
type SharpMetadata = Awaited<ReturnType<Sharp['metadata']>>;
import { dHash } from '../modules/trust/trust.rules';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { PlatformService } from '../modules/platform/platform.service';
import { QueueService } from '../queue/queue.service';
import { IMAGE_WIDTHS, variantPrefix, type MediaVariants } from '../modules/media/media.rules';
import type { MediaAsset } from '../generated/prisma/client';
import { posterFrame, probe, transcodeHls } from './ffmpeg';

/** A problem with the file itself: retrying won't help. */
export class RejectedMedia extends Error {}

const CONTENT_TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

@Injectable()
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
  ) {}

  /** Returns normally on success or permanent rejection; throws on transient errors so the queue retries. */
  async process(mediaId: string, isLastAttempt: boolean): Promise<void> {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.status === 'READY' || media.status === 'REJECTED') return;
    await this.prisma.mediaAsset.update({ where: { id: mediaId }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });

    const dir = await mkdtemp(join(tmpdir(), `media-${mediaId}-`));
    try {
      const original = join(dir, 'original');
      await this.storage.download(media.storageKey, original);
      if (media.kind === 'DOCUMENT') throw new Error('documents are never processed'); // defence in depth: they aren't queued
      const result = media.kind === 'IMAGE' ? await this.image(media, original, dir) : await this.video(media, original, dir);
      await this.prisma.mediaAsset.update({ where: { id: mediaId }, data: { ...result, status: 'READY', readyAt: new Date(), error: null } });
      await this.settlePosts(mediaId);
      this.logger.log(`media ${mediaId} ready (${media.kind})`);
    } catch (e) {
      const rejected = e instanceof RejectedMedia;
      const final = rejected || isLastAttempt;
      this.logger.warn(`media ${mediaId} ${rejected ? 'rejected' : 'failed'}: ${(e as Error).message}`);
      await this.prisma.mediaAsset.update({
        where: { id: mediaId },
        data: { status: final ? (rejected ? 'REJECTED' : 'FAILED') : 'UPLOADED', error: (e as Error).message.slice(0, 500) },
      });
      if (final) {
        await this.settlePosts(mediaId);
        await this.storage.deletePrefix(variantPrefix(mediaId, media.private)).catch(() => undefined);
      }
      if (!final) throw e;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async image(media: MediaAsset, file: string, dir: string) {
    let meta: SharpMetadata;
    try {
      meta = await sharp(file, { limitInputPixels: 100_000_000 }).metadata();
    } catch {
      throw new RejectedMedia('This file is not a readable image.');
    }
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new RejectedMedia(`Unsupported image format: ${meta.format ?? 'unknown'}`);
    // EXIF orientation is applied, then all metadata (including GPS) is dropped — sharp omits it by default.
    const oriented = sharp(file, { limitInputPixels: 100_000_000 }).rotate();
    const { width = 0, height = 0 } = await oriented.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    const images: MediaVariants['images'] = [];
    for (const w of IMAGE_WIDTHS) {
      if (images.length && w >= width) continue; // don't upscale, but always keep at least one
      const out = join(dir, `${w}.webp`);
      await oriented.clone().resize({ width: Math.min(w, width), withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
      const key = `${variantPrefix(media.id, media.private)}${w}.webp`;
      // Private photos must never sit in a shared cache.
      await this.storage.upload(key, out, 'image/webp', media.private ? 'private, max-age=900' : undefined);
      images.push({ width: Math.min(w, width), key });
    }
    return { width, height, durationMs: null, variants: { images } satisfies MediaVariants, perceptualHash: await fingerprint(oriented.clone()) };
  }

  private async video(media: MediaAsset, file: string, dir: string) {
    let info;
    try {
      info = await probe(file);
    } catch {
      throw new RejectedMedia('This file is not a readable video.');
    }
    const maxSeconds = await this.platform.getSetting<number>('media.maxVideoSeconds');
    if (info.durationMs > maxSeconds * 1000 + 500) throw new RejectedMedia(`Video is ${Math.round(info.durationMs / 1000)} s; the limit is ${maxSeconds} s.`);
    if (info.durationMs < 500) throw new RejectedMedia('Video is too short.');

    const out = join(dir, 'out');
    await transcodeHls(file, out, info.hasAudio);
    await posterFrame(file, join(out, 'poster.jpg'), info.durationMs);

    const prefix = variantPrefix(media.id);
    for (const f of await walk(out)) {
      if ((await stat(f)).size === 0) continue;
      const rel = relative(out, f).split('\\').join('/');
      const ext = rel.slice(rel.lastIndexOf('.'));
      await this.storage.upload(`${prefix}${rel}`, f, CONTENT_TYPES[ext] ?? 'application/octet-stream');
    }
    return {
      width: info.width,
      height: info.height,
      durationMs: info.durationMs,
      variants: { hls: `${prefix}master.m3u8`, poster: `${prefix}poster.jpg` } satisfies MediaVariants,
      // The poster frame stands in for the video when looking for copies of someone else's upload.
      perceptualHash: await fingerprint(sharp(join(out, 'poster.jpg'))).catch(() => null),
    };
  }

  /** Publishes posts whose media are all ready; fails posts that contain failed media. */
  private async settlePosts(mediaId: string): Promise<void> {
    const posts = await this.prisma.post.findMany({
      where: { status: 'PROCESSING', media: { some: { mediaId } } },
      select: { id: true, media: { select: { media: { select: { status: true } } } } },
    });
    for (const p of posts) {
      const statuses = p.media.map((m) => m.media.status);
      if (statuses.some((s) => s === 'FAILED' || s === 'REJECTED')) {
        const r = await this.prisma.post.updateMany({ where: { id: p.id, status: 'PROCESSING' }, data: { status: 'FAILED' } });
        if (r.count) this.queue.notify({ type: 'POST_FAILED', postId: p.id });
      } else if (statuses.every((s) => s === 'READY')) {
        const r = await this.prisma.post.updateMany({ where: { id: p.id, status: 'PROCESSING' }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
        if (r.count) {
          this.queue.notify({ type: 'POST_PUBLISHED', postId: p.id });
          this.queue.assess('POST', p.id);
        }
      }
    }
  }
}

/** Difference hash of an image (see trust.rules), for spotting the same photo uploaded by someone else. */
async function fingerprint(img: Sharp): Promise<string> {
  const raw = await img.removeAlpha().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  // One byte per pixel is expected; if libvips keeps extra channels, take the first of each pixel.
  const step = raw.length / 72;
  return dHash(step === 1 ? raw : Uint8Array.from({ length: 72 }, (_, i) => raw[i * step]));
}
