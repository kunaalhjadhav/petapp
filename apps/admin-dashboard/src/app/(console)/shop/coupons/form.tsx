'use client';

import { useEffect, useState } from 'react';

/** Hidden field with the browser's UTC offset, set after load (it's unknown during server rendering). */
export function TzOffset() {
  const [tz, setTz] = useState(0);
  useEffect(() => setTz(new Date().getTimezoneOffset()), []);
  return <input type="hidden" name="tzOffset" value={tz} />;
}

/** "PERCENT" shows "%", "FLAT" shows "₹" next to the value. */
export function KindAndValue() {
  const [kind, setKind] = useState('PERCENT');
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="kind" className="text-sm font-medium">
          Type
        </label>
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-10 rounded-md border border-line bg-panel px-3 text-sm"
        >
          <option value="PERCENT">Percentage off</option>
          <option value="FLAT">Rupees off</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="value" className="text-sm font-medium">
          {kind === 'PERCENT' ? 'Discount (%)' : 'Discount (₹)'}
        </label>
        <input
          id="value"
          name="value"
          required
          inputMode="decimal"
          className="h-10 rounded-md border border-line bg-panel px-3 text-sm"
        />
      </div>
    </div>
  );
}

/** Start and end inputs, defaulting to now and 30 days ahead in the browser's own time zone. */
export function ValidityWindow() {
  const [d, setD] = useState({ start: '', end: '' });
  useEffect(() => {
    const local = (ms: number) => {
      const t = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
    };
    setD({ start: local(Date.now()), end: local(Date.now() + 30 * 86_400_000) });
  }, []);
  const cls = 'h-10 rounded-md border border-line bg-panel px-3 text-sm';
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="startsAt" className="text-sm font-medium">
          Starts
        </label>
        <input
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          required
          value={d.start}
          onChange={(e) => setD({ ...d, start: e.target.value })}
          className={cls}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="endsAt" className="text-sm font-medium">
          Ends
        </label>
        <input
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          required
          value={d.end}
          onChange={(e) => setD({ ...d, end: e.target.value })}
          className={cls}
        />
      </div>
    </div>
  );
}
