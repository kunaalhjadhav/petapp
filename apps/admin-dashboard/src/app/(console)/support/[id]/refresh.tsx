'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Keeps an open ticket current: new replies from the person appear without reloading. Pauses in background tabs. */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
