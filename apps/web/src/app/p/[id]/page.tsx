import { permanentRedirect } from 'next/navigation';

/** Older share links (/p/… and /post/…) now live at /reel/…. */
export default async function Legacy({ params }: { params: Promise<{ id: string }> }) {
  permanentRedirect(`/reel/${encodeURIComponent((await params).id)}`);
}
