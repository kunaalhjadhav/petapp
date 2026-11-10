import Link from 'next/link';
import type { Metadata } from 'next';
import { get } from '@/lib/api';
import { pageMeta } from '@/lib/meta';
import { faqLd, ldJson } from '@/lib/seo';
import { site } from '@/lib/site';
import type { HelpCenter } from '@/lib/types';
import { Markdown } from '@/components/markdown';
import { Section, Tag } from '@/components/site';

export const metadata: Metadata = pageMeta({
  title: 'Help and support',
  description: 'Answers about bookings, orders, refunds, contests and your PetApp account, and how to contact the PetApp team.',
  path: '/help',
});

/** The help center: the same answers as Help & support in the app. Also the store listings' support page. */
export default async function Help() {
  const help = await get<HelpCenter>('/support/faqs?app=customer');
  const faqs = help?.faqs ?? [];
  const topics = (help?.categories ?? []).filter((c) => faqs.some((f) => f.categoryId === c.id));
  const loose = faqs.filter((f) => !topics.some((t) => t.id === f.categoryId));
  const groups = [...topics.map((t) => ({ title: t.name, items: faqs.filter((f) => f.categoryId === t.id) })), ...(loose.length ? [{ title: 'More questions', items: loose }] : [])];

  return (
    <>
      {faqs.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqLd(faqs)) }} />}
      <Tag title="Help and support" />
      {groups.length === 0 ? (
        <p className="mt-8 text-muted">Answers to common questions will appear here soon.</p>
      ) : (
        groups.map((g) => (
          <Section key={g.title} title={g.title}>
            <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
              {g.items.map((f) => (
                <details key={f.id} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {f.question}
                      <span aria-hidden className="text-collar transition-transform group-open:rotate-45">
                        +
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3">
                    <Markdown source={f.answer} />
                  </div>
                </details>
              ))}
            </div>
          </Section>
        ))
      )}
      <Section title="Still need help?">
        <p className="max-w-prose">
          In the PetApp app, go to <strong>Settings → Help &amp; support</strong> and tap <strong>Contact support</strong>. We reply in the app
          and send you a notification.
          {site.supportEmail && (
            <>
              {' '}
              You can also email{' '}
              <a className="text-collar underline" href={`mailto:${site.supportEmail}`}>
                {site.supportEmail}
              </a>
              .
            </>
          )}
        </p>
        <p className="mt-3 max-w-prose text-muted">
          Policies are on the{' '}
          <Link className="text-collar underline" href="/legal">
            policies and terms
          </Link>{' '}
          page.
        </p>
      </Section>
    </>
  );
}
