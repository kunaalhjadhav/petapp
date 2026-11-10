import Link from 'next/link';
import { Empty, Panel } from '@/components/ui';

export default function NotFound() {
  return (
    <Panel>
      <Empty title="This record doesn’t exist">
        It may have been deleted, or the link is wrong.{' '}
        <Link href="/" className="text-teal hover:underline">
          Go to the overview
        </Link>
      </Empty>
    </Panel>
  );
}
