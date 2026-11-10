'use client';

import { useActionState } from 'react';
import { ErrorNote, buttonClass, inputClass } from '@/components/ui';
import type { ImportState } from './actions';

/** Upload or paste "pincode,locality,lat,lng" rows: Check first, then Import. */
export function ImportForm({ action }: { action: (s: ImportState, fd: FormData) => Promise<ImportState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const r = state?.result;
  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-4">
      <p className="text-sm text-muted">
        One row per PIN code: <code>pincode,area,latitude,longitude</code>. The area and coordinates are optional; new areas are created by name. A
        header row is skipped. PIN codes already in another city are reported, not moved.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        CSV file
        <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Or paste rows
        <textarea name="csv" rows={4} className={`${inputClass} h-auto py-2 font-mono text-xs`} placeholder={'411001,Camp,18.5122,73.8860\n411014,Viman Nagar,,'} />
      </label>
      <div className="flex gap-2">
        <button name="mode" value="check" disabled={pending} className={buttonClass('secondary')}>
          Check
        </button>
        <button name="mode" value="import" disabled={pending} className={buttonClass('primary')}>
          Import
        </button>
      </div>
      {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
      {r && (
        <div role="status" className="rounded-md border border-line-soft bg-paper px-3 py-2 text-sm">
          <p className="font-medium">
            {r.dryRun ? 'Check: ' : 'Imported: '}
            {r.pincodesAdded} new PIN code{r.pincodesAdded === 1 ? '' : 's'}, {r.pincodesUpdated} updated, {r.areasCreated} new area{r.areasCreated === 1 ? '' : 's'}
            {r.dryRun ? ' would be saved.' : '.'}
          </p>
          {r.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-danger">
              {r.errors.slice(0, 50).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {r.errors.length > 50 && <li>…and {r.errors.length - 50} more</li>}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
