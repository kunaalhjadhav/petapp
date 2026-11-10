import Link from 'next/link';
import { Tag } from '@/components/site';

export default function NotFound() {
  return (
    <>
      <Tag title="Nothing here">This page doesn’t exist, or it isn’t shared publicly.</Tag>
      <p className="mt-8 max-w-prose text-lg">
        If someone sent you this link, ask them to share it again from the app. Or{' '}
        <Link href="/" className="text-collar underline">
          go to the PetApp home page
        </Link>
        .
      </p>
    </>
  );
}
