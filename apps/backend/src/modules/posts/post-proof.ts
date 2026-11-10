import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Why a post can't be used as proof for a contest task or a challenge check-in, in words people can act on
 * (spec §85: "Your video is still being processed"), or null when it can. Only the person's own live posts count.
 */
export async function postProofProblem(prisma: Pick<PrismaService, 'post'>, postId: string, userId: string): Promise<string | null> {
  const post = await prisma.post.findFirst({ where: { id: postId, authorId: userId, deletedAt: null }, select: { status: true } });
  if (post?.status === 'PUBLISHED') return null;
  if (post?.status === 'PROCESSING') return 'Your video is still being processed. Try again once it’s live; we’ll notify you.';
  return 'Choose one of your published posts.';
}
