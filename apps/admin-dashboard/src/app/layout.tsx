import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PetApp Admin', template: '%s — PetApp Admin' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans text-[15px] leading-6">{children}</body>
    </html>
  );
}
