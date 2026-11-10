import type { Metadata } from 'next';
import { OpenInApp, StoreLinks, Tag } from '@/components/site';

export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false, follow: false },
};

/** Bookings are private: this page only hands over to the app, where the person is signed in. */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Tag title="Your booking">
        Booking details, changes and cancellations are in the PetApp app.
      </Tag>
      <p className="mt-8 max-w-prose text-lg">
        Open PetApp on your phone to see this booking. If you don’t have the app yet, get it here
        and sign in with the same mobile number.
      </p>
      <div className="mt-6">
        <StoreLinks />
      </div>
      <OpenInApp kind="booking" keyValue={id} label="Your booking is in the app" />
    </>
  );
}
