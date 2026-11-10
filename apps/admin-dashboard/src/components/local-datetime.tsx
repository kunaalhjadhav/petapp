'use client';

import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (iso: string) => {
  const t = new Date(iso);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};

/**
 * A date-and-time field in the browser's time zone, filled from an ISO time after load (the zone is
 * unknown while rendering on the server). Sends `tzOffset` too, so the server can read it back.
 */
export function LocalDateTime({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string | null;
  hint?: string;
}) {
  const [v, setV] = useState('');
  const [tz, setTz] = useState(0);
  useEffect(() => {
    setV(value ? local(value) : '');
    setTz(new Date().getTimezoneOffset());
  }, [value]);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        name={name}
        type="datetime-local"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="h-9 rounded-md border border-line bg-panel px-3 text-sm"
      />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      <input type="hidden" name="tzOffset" value={tz} />
    </label>
  );
}
