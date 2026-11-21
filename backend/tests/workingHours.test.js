/**
 * Tests for the pure working-hours module.
 * All times in ISO 8601 UTC (the module converts internally to IST).
 * IST = UTC+5:30
 *
 * Working hours: 09:30-18:30 IST = 04:00-13:00 UTC
 */
import { describe, it, expect } from 'vitest';
import {
  nextWorkingStart,
  addWorkingMinutes,
  workingMinutesBetween,
  urgentResolutionDeadline,
  isWorkingDay,
} from '../src/lib/workingHours.js';
import { DateTime } from 'luxon';

// Convenience: IST time -> UTC ISO string
const ist = (y, mo, d, h = 0, m = 0) =>
  DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: m }, { zone: 'Asia/Kolkata' }).toUTC().toISO();

// Known holidays for tests
const HOLIDAYS = ['2024-11-01', '2024-11-02', '2025-01-26'];

// ───────────────────────────────────────────────
// isWorkingDay
// ───────────────────────────────────────────────
describe('isWorkingDay', () => {
  it('Monday is a working day', () => {
    // 2024-11-04 is Monday
    const dt = DateTime.fromISO('2024-11-04', { zone: 'Asia/Kolkata' });
    expect(isWorkingDay(dt, HOLIDAYS)).toBe(true);
  });

  it('Saturday is NOT a working day', () => {
    const dt = DateTime.fromISO('2024-11-02', { zone: 'Asia/Kolkata' });
    // But Nov 2 is also a holiday — either way, it's not a working day
    expect(isWorkingDay(dt, [])).toBe(false); // Saturday
  });

  it('Sunday is NOT a working day', () => {
    const dt = DateTime.fromISO('2024-11-03', { zone: 'Asia/Kolkata' });
    expect(isWorkingDay(dt, [])).toBe(false);
  });

  it('Holiday is NOT a working day', () => {
    // 2024-11-01 is Diwali (Friday)
    const dt = DateTime.fromISO('2024-11-01', { zone: 'Asia/Kolkata' });
    expect(isWorkingDay(dt, HOLIDAYS)).toBe(false);
  });
});

// ───────────────────────────────────────────────
// nextWorkingStart
// ───────────────────────────────────────────────
describe('nextWorkingStart', () => {
  it('During working hours on a weekday → same timestamp', () => {
    // 2024-11-04 Mon 10:00 IST
    const input = ist(2024, 11, 4, 10, 0);
    const result = nextWorkingStart(input, HOLIDAYS);
    // Should stay at or be 09:30 that day (it's during hours → unchanged)
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.hour).toBe(10);
    expect(dt.minute).toBe(0);
  });

  it('Before 09:30 on a weekday → 09:30 same day', () => {
    // 2024-11-04 Mon 08:00 IST
    const input = ist(2024, 11, 4, 8, 0);
    const result = nextWorkingStart(input, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-04');
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
  });

  it('After 18:30 on a weekday → 09:30 next working day', () => {
    // 2024-11-04 Mon 19:00 IST
    const input = ist(2024, 11, 4, 19, 0);
    const result = nextWorkingStart(input, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-05'); // Tuesday
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
  });

  it('KEY TEST: Friday 18:00 IST → Monday 09:30 IST (not late Sunday)', () => {
    // 2024-11-08 Fri 18:00 IST - within working hours but only 30 mins left
    // But if it's 18:00 → still within [9:30, 18:30), so nextWorkingStart = that moment
    // The important test: 18:31 on Friday → Monday morning
    const friday1831 = ist(2024, 11, 8, 18, 31);
    const result = nextWorkingStart(friday1831, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
  });

  it('Saturday → Monday 09:30', () => {
    const satDay = ist(2024, 11, 9, 14, 0); // Saturday afternoon
    const result = nextWorkingStart(satDay, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
  });

  it('Sunday → Monday 09:30', () => {
    const sunDay = ist(2024, 11, 10, 9, 0); // Sunday morning
    const result = nextWorkingStart(sunDay, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
  });

  it('Friday 18:00 (still in hours) → that same Friday 18:00', () => {
    // 18:00 < 18:30, so still within working hours
    const fri1800 = ist(2024, 11, 8, 18, 0);
    const result = nextWorkingStart(fri1800, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-08');
    expect(dt.hour).toBe(18);
  });

  it('Holiday (Diwali Friday) → next non-holiday Monday', () => {
    // 2024-11-01 is Diwali (Friday), 2024-11-02 is also holiday (Saturday anyway)
    const diwaliFri = ist(2024, 11, 1, 10, 0);
    const result = nextWorkingStart(diwaliFri, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-04'); // Monday
  });
});

// ───────────────────────────────────────────────
// addWorkingMinutes
// ───────────────────────────────────────────────
describe('addWorkingMinutes', () => {
  it('120 minutes (urgent SLA) from 09:30 Mon = 11:30 Mon', () => {
    const start = ist(2024, 11, 4, 9, 30); // Mon
    const result = addWorkingMinutes(start, 120, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-04');
    expect(dt.hour).toBe(11);
    expect(dt.minute).toBe(30);
  });

  it('540 minutes (1 full working day) from Mon 09:30 = Mon 18:30', () => {
    // 09:30 + 540 min = 18:30 that same day (end of working day).
    // "1 working day SLA" starts at the clock-start and ends at 18:30.
    const start = ist(2024, 11, 4, 9, 30); // Mon
    const result = addWorkingMinutes(start, 540, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-04'); // Same Monday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('1620 minutes (3 days) from Mon 09:30 = Wed 18:30', () => {
    // 540 Mon + 540 Tue + 540 Wed = 1620; lands at Wed 18:30
    const start = ist(2024, 11, 4, 9, 30); // Mon
    const result = addWorkingMinutes(start, 1620, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-06'); // Wednesday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('Wraps over weekend correctly: Fri 15:00 + 270 min', () => {
    // Fri 15:00 IST. Remaining = 18:30 - 15:00 = 210 min.
    // 270 - 210 = 60 min left on Monday
    // Monday 09:30 + 60 = 10:30 Mon
    const start = ist(2024, 11, 8, 15, 0); // Friday
    const result = addWorkingMinutes(start, 270, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
    expect(dt.hour).toBe(10);
    expect(dt.minute).toBe(30);
  });

  it('Skips holiday: start Fri 09:30, 540 min; Diwali Mon 2025-10-20 → Fri 18:30', () => {
    // Fri 09:30 + 540 min = Fri 18:30 (holiday is Monday, but 540 min fits in Friday alone)
    const holidays = ['2025-10-20'];
    const start = ist(2025, 10, 17, 9, 30); // Friday
    const result = addWorkingMinutes(start, 540, holidays);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    // 540 min from Fri 09:30 ends at Fri 18:30 (doesn't need Mon at all)
    expect(dt.toISODate()).toBe('2025-10-17');
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('Skips holiday when it falls in the middle: Wed 09:30 + 1080 (2 days), Fri holiday', () => {
    // Wed + Thu = 1080 min. If Fri is holiday, it's skipped. Result = Thu 18:30.
    const holidays = ['2024-11-08']; // "holiday" on Friday
    const start = ist(2024, 11, 6, 9, 30); // Wednesday
    const result = addWorkingMinutes(start, 1080, holidays);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-07'); // Thursday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('2700 minutes (5 working days) from Mon 09:30 = Fri 18:30', () => {
    // Mon 540 + Tue 540 + Wed 540 + Thu 540 + Fri 540 = 2700; lands Fri 18:30
    const start = ist(2024, 11, 4, 9, 30); // Mon Nov 4
    const result = addWorkingMinutes(start, 2700, HOLIDAYS);
    const dt = DateTime.fromISO(result, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-08'); // Friday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });
});

// ───────────────────────────────────────────────
// workingMinutesBetween
// ───────────────────────────────────────────────
describe('workingMinutesBetween', () => {
  it('Same day, within hours: 09:30 to 11:30 = 120 min', () => {
    const a = ist(2024, 11, 4, 9, 30);
    const b = ist(2024, 11, 4, 11, 30);
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBeCloseTo(120, 0);
  });

  it('Across a weekend: Fri 17:30 to Mon 10:30 = 60+60=120 min', () => {
    // Fri 17:30 to 18:30 = 60 min; then Mon 09:30 to 10:30 = 60 min
    const a = ist(2024, 11, 8, 17, 30); // Fri
    const b = ist(2024, 11, 11, 10, 30); // Mon
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBeCloseTo(120, 0);
  });

  it('a === b → 0 minutes', () => {
    const a = ist(2024, 11, 4, 10, 0);
    expect(workingMinutesBetween(a, a, HOLIDAYS)).toBe(0);
  });

  it('a > b → 0 minutes', () => {
    const a = ist(2024, 11, 4, 11, 0);
    const b = ist(2024, 11, 4, 10, 0);
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBe(0);
  });

  it('Fully outside hours → 0', () => {
    // Friday night through Sunday
    const a = ist(2024, 11, 8, 20, 0); // Fri 20:00
    const b = ist(2024, 11, 10, 22, 0); // Sun 22:00
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBe(0);
  });

  it('Paused over a weekend: paused Fri 17:30, resumed Mon 10:30 = 120 working min', () => {
    const a = ist(2024, 11, 8, 17, 30);
    const b = ist(2024, 11, 11, 10, 30);
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBeCloseTo(120, 0);
  });

  it('Full 5-day span Mon to Mon = 2700 min', () => {
    const a = ist(2024, 11, 4, 9, 30); // Mon
    const b = ist(2024, 11, 11, 9, 30); // Mon+5 workdays
    expect(workingMinutesBetween(a, b, HOLIDAYS)).toBeCloseTo(2700, 0);
  });

  it('Skips holiday in middle of span', () => {
    // Oct 17 (Fri) 09:30 to Oct 22 (Wed) 09:30, holiday Oct 20 (Mon)
    const holidays = ['2025-10-20'];
    const a = ist(2025, 10, 17, 9, 30);
    const b = ist(2025, 10, 22, 9, 30);
    // Fri 540 + (Mon holiday skip) + Tue 540 = 1080 min
    expect(workingMinutesBetween(a, b, holidays)).toBeCloseTo(1080, 0);
  });

  it('Ticket arriving Friday 18:00 is NOT late on Sunday morning', () => {
    // Friday 18:00 IST - clamp: within hours, 30 min left
    // Saturday & Sunday have 0 working minutes
    const friday1800 = ist(2024, 11, 8, 18, 0);
    const sundayMorning = ist(2024, 11, 10, 8, 0);
    expect(workingMinutesBetween(friday1800, sundayMorning, HOLIDAYS)).toBeCloseTo(30, 0);
  });
});

// ───────────────────────────────────────────────
// urgentResolutionDeadline
// ───────────────────────────────────────────────
describe('urgentResolutionDeadline', () => {
  it('Created Mon 10:00 IST → deadline Mon 18:30 IST', () => {
    const created = ist(2024, 11, 4, 10, 0);
    const deadline = urgentResolutionDeadline(created, HOLIDAYS);
    const dt = DateTime.fromISO(deadline, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-04');
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('Created Friday 20:00 IST → deadline NEXT Monday 18:30 IST', () => {
    const created = ist(2024, 11, 8, 20, 0); // After hours Friday
    const deadline = urgentResolutionDeadline(created, HOLIDAYS);
    const dt = DateTime.fromISO(deadline, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });

  it('Created Saturday → deadline Monday 18:30', () => {
    const created = ist(2024, 11, 9, 14, 0); // Saturday
    const deadline = urgentResolutionDeadline(created, HOLIDAYS);
    const dt = DateTime.fromISO(deadline, { zone: 'utc' }).setZone('Asia/Kolkata');
    expect(dt.toISODate()).toBe('2024-11-11'); // Monday
    expect(dt.hour).toBe(18);
    expect(dt.minute).toBe(30);
  });
});
