import type { Metadata, Viewport } from 'next';
import { get } from '@/lib/api';
import { site } from '@/lib/site';
import type { LegalSummary } from '@/lib/types';
import { SiteFooter, SiteHeader } from '@/components/site';
import './globals.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(site.url),
    title: { default: 'PetApp: pets, reels, contests, care and shopping', template: '%s | PetApp' },
    description:
      'Share your pet’s best moments, enter contests, book groomers and vets nearby, and shop for pet supplies.',
    applicationName: 'PetApp',
    openGraph: { siteName: 'PetApp', locale: 'en_IN', type: 'website' },
    twitter: { card: 'summary_large_image' },
    robots: site.indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: '#1d5c58', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const legal = (await get<LegalSummary[]>('/legal').catch(() => null)) ?? [];
  return (
    <html lang="en-IN">
      <body className="min-h-dvh font-sans text-[16px] leading-relaxed">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-20 focus:rounded focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
          {children}
        </main>
        <SiteFooter legal={legal} />
      </body>
    </html>
  );
}
