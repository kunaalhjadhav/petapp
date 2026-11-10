import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';

@Injectable()
export class MaintenanceProcessor {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Trending score for posts from the last 7 days:
   * weighted engagement divided by age decay, so new posts with early engagement rise.
   */
  async recomputeScores(): Promise<number> {
    const n = await this.prisma.$executeRaw`
      UPDATE "Post" SET score =
        ("likeCount" * 1.0 + "commentCount" * 2.0 + "saveCount" * 3.0 + "shareCount" * 3.0 + "viewCount" * 0.05 + 1.0)
        / power(GREATEST(EXTRACT(EPOCH FROM (now() - "publishedAt")) / 3600.0, 0) + 2.0, 1.5)
      WHERE status = 'PUBLISHED' AND "publishedAt" > now() - interval '7 days'`;
    await this.prisma.$executeRaw`
      UPDATE "Post" SET score = 0 WHERE status = 'PUBLISHED' AND "publishedAt" <= now() - interval '7 days' AND score <> 0`;
    this.logger.log(`recomputed scores for ${n} posts`);
    return n;
  }

  /** Uploads that were never completed within 24 hours are deleted. */
  async cleanupStaleUploads(): Promise<number> {
    const stale = await this.prisma.mediaAsset.findMany({
      where: { status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - 86_400_000) } },
      select: { id: true, storageKey: true, multipartUploadId: true },
      take: 500,
    });
    for (const m of stale) {
      // A resumable upload left unfinished: storage keeps its parts until the upload is aborted.
      if (m.multipartUploadId) await this.storage.abortMultipart(m.storageKey, m.multipartUploadId);
      await this.storage.deletePrefix(m.storageKey).catch(() => undefined);
      await this.prisma.mediaAsset.delete({ where: { id: m.id } }).catch(() => undefined);
    }
    if (stale.length) this.logger.log(`removed ${stale.length} abandoned uploads`);
    return stale.length;
  }
}
