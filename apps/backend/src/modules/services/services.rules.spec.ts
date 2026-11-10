import {
  availableSlots,
  bookingCode,
  indiaMidnight,
  indiaWeekday,
  refundFor,
  split,
  type SlotInput,
} from './services.rules';

const at = (iso: string) => new Date(iso);
// 2026-10-12 is a Monday. 09:00 IST = 03:30 UTC.
const base: SlotInput = {
  date: '2026-10-12',
  hours: [{ opensMin: 9 * 60, closesMin: 12 * 60 }],
  durationMin: 60,
  bufferMin: 0,
  stepMin: 30,
  concurrency: 1,
  busy: [],
  timeOff: [],
  now: at('2026-10-01T00:00:00Z'),
  minLeadMin: 60,
};
const times = (slots: ReturnType<typeof availableSlots>) =>
  slots.map((s) => s.startsAt.toISOString().slice(11, 16));

describe('India dates', () => {
  it('midnight and weekday in India time', () => {
    expect(indiaMidnight('2026-10-12').toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(indiaWeekday('2026-10-12')).toBe(1);
  });
});

describe('availableSlots', () => {
  it('fits services inside opening hours (UTC shown: 09:00 IST = 03:30Z)', () => {
    expect(times(availableSlots(base))).toEqual(['03:30', '04:00', '04:30', '05:00', '05:30']); // last start 11:00 IST
  });
  it('respects a lunch break, buffer and time off', () => {
    const s = availableSlots({
      ...base,
      hours: [
        { opensMin: 540, closesMin: 660 },
        { opensMin: 720, closesMin: 840 },
      ],
      bufferMin: 30,
      timeOff: [{ start: at('2026-10-12T06:30:00Z'), end: at('2026-10-12T07:00:00Z') }],
    });
    // Morning 09:00–11:00 IST: 09:00, 09:30, 10:00 (each blocks 90 min incl. buffer, but only one booking exists so all fit).
    // Afternoon 12:00–14:00 IST with time off 12:00–12:30: 12:30 and 13:00 fit; 13:30 would end after closing.
    expect(times(s)).toEqual(['03:30', '04:00', '04:30', '07:00', '07:30']);
  });
  it('uses free staff slots and skips times where every slot is taken', () => {
    const busy = [
      { start: at('2026-10-12T03:30:00Z'), end: at('2026-10-12T04:30:00Z'), slotIndex: 0 },
    ];
    expect(times(availableSlots({ ...base, busy }))).toEqual(['04:30', '05:00', '05:30']);
    const two = availableSlots({ ...base, busy, concurrency: 2 });
    expect(two[0]).toMatchObject({ slotIndex: 1 });
    expect(times(two)).toHaveLength(5);
  });
  it('needs the minimum lead time', () => {
    expect(
      times(availableSlots({ ...base, now: at('2026-10-12T03:00:00Z'), minLeadMin: 60 })),
    ).toEqual(['04:00', '04:30', '05:00', '05:30']);
  });
});

describe('money', () => {
  it('splits commission in paise', () => {
    expect(split(799_00, 1500)).toEqual({ platformFeePaise: 119_85, partnerEarningPaise: 679_15 });
    expect(split(99, 1500)).toEqual({ platformFeePaise: 15, partnerEarningPaise: 84 });
  });
  it('refunds by who cancels and how early', () => {
    const p = { fullRefundHours: 24, lateRefundPct: 50 };
    const start = at('2026-10-12T05:00:00Z');
    expect(refundFor(1000_00, start, at('2026-10-11T04:00:00Z'), 'CUSTOMER', p)).toBe(1000_00); // 25 h ahead
    expect(refundFor(1000_00, start, at('2026-10-12T01:00:00Z'), 'CUSTOMER', p)).toBe(500_00); // 4 h ahead
    expect(refundFor(1000_00, start, at('2026-10-12T06:00:00Z'), 'CUSTOMER', p)).toBe(0); // after start
    expect(refundFor(1000_00, start, at('2026-10-12T06:00:00Z'), 'PARTNER', p)).toBe(1000_00);
  });
});

it('booking codes are short and unambiguous', () => {
  const c = bookingCode(new Uint8Array([0, 1, 2, 31, 32, 255]));
  expect(c).toMatch(/^PB-[A-HJ-NP-Z2-9]{6}$/);
});
