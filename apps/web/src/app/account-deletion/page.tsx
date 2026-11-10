import Link from 'next/link';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/meta';
import { site } from '@/lib/site';
import { Section, Tag } from '@/components/site';

export const metadata: Metadata = pageMeta({
  title: 'Delete your PetApp account',
  description:
    'How to delete your PetApp account and data, what is erased, and what the law requires us to keep.',
  path: '/account-deletion',
});

/** The page app stores ask for: how to delete an account, from the app or without it. */
export default function AccountDeletion() {
  return (
    <>
      <Tag title="Delete your account" />
      <Section title="In the app">
        <ol className="flex max-w-prose list-decimal flex-col gap-1.5 pl-6 text-lg">
          <li>Open PetApp and go to Me, then Settings.</li>
          <li>
            Tap Your data and privacy. If you want a copy of your data first, tap Ask for a copy.
          </li>
          <li>Tap Delete account and confirm.</li>
        </ol>
        <p className="mt-3 max-w-prose text-muted">
          You are signed out on every device straight away. Your account is erased after a grace
          period, and the app shows the date; signing in before then keeps it.
        </p>
      </Section>
      <Section title="Without the app">
        <p className="max-w-prose">
          {site.supportEmail ? (
            <>
              Email{' '}
              <a
                className="text-collar underline"
                href={`mailto:${site.supportEmail}?subject=Delete%20my%20PetApp%20account`}
              >
                {site.supportEmail}
              </a>{' '}
              from the email address on your account, or tell us the mobile number you sign in with.
              We confirm it’s you before deleting anything.
            </>
          ) : (
            <>
              Write to our Grievance Officer at the address in the{' '}
              <Link className="text-collar underline" href="/legal/privacy-policy">
                Privacy Policy
              </Link>
              , with the mobile number you sign in with. We confirm it’s you before deleting
              anything.
            </>
          )}
        </p>
      </Section>
      <Section title="What is erased, and what is kept">
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-6">
          <li>
            Erased: your profile, sign-ins, addresses, pets’ private details, posts, photos and
            videos, comments, follows, chats with PetApp Assistant and your viewing history.
          </li>
          <li>
            Kept without your profile, because tax and accounting law require it: orders, bookings,
            payments, refunds, invoices and payouts.
          </li>
          <li>
            Details are in the{' '}
            <Link className="text-collar underline" href="/legal/privacy-policy">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </Section>
    </>
  );
}
