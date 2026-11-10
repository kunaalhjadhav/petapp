'use client';

import { Button, Empty, Panel } from '@/components/ui';

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const unreachable = /not reachable/i.test(error.message);
  return (
    <Panel>
      <Empty title={unreachable ? 'The PetApp API isn’t responding' : 'This page couldn’t load'}>
        <p>
          {unreachable
            ? 'Check that the backend is running, then try again.'
            : 'Try again. If it keeps happening, share this reference with the engineering team.'}
        </p>
        {error.digest && <p className="mt-2 text-xs text-faint">Reference {error.digest}</p>}
        <div className="mt-4">
          <Button onClick={reset}>Try again</Button>
        </div>
      </Empty>
    </Panel>
  );
}
