/**
 * Working-hours calculation module — PURE, no DB access.
 *
 * Working day = Mon–Fri 09:30–18:30 IST (Asia/Kolkata).
 * Weekends and holidays are skipped entirely.
 *
 * All inputs/outputs are ISO 8601 strings or luxon DateTime objects.
 * An injectable `nowFn` can be passed for testing (not needed here but
 * the holiday list is injected so the module is fully deterministic).
 *
 * Business-hours math summary:
 *   - Convert every input to IST DateTime
 *   - Clamp to the nearest working-hours start if outside working hours
 *   - Walk forward/backward minute by minute would be O(minutes),
 *     so instead compute whole working-day skips, then partial days.
 *   - A "working day" contributes at most WORKING_MINUTES_PER_DAY (540) minutes.
 */
import { DateTime } from 'luxon';

export const IST = 'Asia/Kolkata';
export const WORK_START = { hour: 9, minute: 30 };
export const WORK_END   = { hour: 18, minute: 30 };
export const WORKING_MINUTES_PER_DAY = 540; // (18:30 - 09:30) * 60

/**
 * Robustly converts any Date, ISO string, SQL datetime string, or Luxon DateTime
 * into an IST-zoned Luxon DateTime object.
 */
export function toLuxonIst(input) {
  if (!input) return DateTime.utc().setZone(IST);
  if (input instanceof Date) return DateTime.fromJSDate(input, { zone: 'utc' }).setZone(IST);
  if (typeof input === 'string') {
    let dt = DateTime.fromISO(input, { zone: 'utc' });
    if (!dt.isValid) dt = DateTime.fromSQL(input, { zone: 'utc' });
    if (!dt.isValid) dt = DateTime.fromJSDate(new Date(input), { zone: 'utc' });
    return dt.isValid ? dt.setZone(IST) : DateTime.utc().setZone(IST);
  }
  if (input.isLuxonDateTime) return input.setZone(IST);
  return DateTime.fromJSDate(new Date(input), { zone: 'utc' }).setZone(IST);
}

/**
 * Returns true if the given luxon DateTime (in IST) is a working day
 * (Mon-Fri and not a holiday).
 * @param {DateTime} dt - DateTime in IST zone
 * @param {string[]} holidays - Array of 'YYYY-MM-DD' holiday dates
 */
export function isWorkingDay(dt, holidays = []) {
  const dow = dt.weekday; // 1=Mon … 7=Sun
  if (dow === 6 || dow === 7) return false; // Sat, Sun
  const dateStr = dt.toISODate();
  return !holidays.includes(dateStr);
}

/**
 * Returns working-day start DateTime on the given day.
 * Does NOT check if it is a working day.
 */
function dayStart(dt) {
  return dt.set({ hour: WORK_START.hour, minute: WORK_START.minute, second: 0, millisecond: 0 });
}

/**
 * Returns working-day end DateTime on the given day.
 */
function dayEnd(dt) {
  return dt.set({ hour: WORK_END.hour, minute: WORK_END.minute, second: 0, millisecond: 0 });
}

/**
 * nextWorkingStart(isoString, holidays) -> ISO string
 *
 * If `date` is during working hours on a working day, returns `date` unchanged.
 * If before 09:30 on a working day, returns 09:30 that day.
 * If after 18:30, or on a weekend/holiday, returns 09:30 of the next working day.
 *
 * Key edge case: ticket arriving Friday 18:00 should NOT be late Sunday morning —
 * it starts counting at Monday 09:30.
 */
export function nextWorkingStart(isoStringOrDt, holidays = []) {
  let dt = toLuxonIst(isoStringOrDt);

  // If this is a working day and within working hours, we're good
  if (isWorkingDay(dt, holidays)) {
    const start = dayStart(dt);
    const end   = dayEnd(dt);
    if (dt >= start && dt < end) {
      // Already in working hours — return as-is (UTC ISO)
      return dt.toUTC().toISO();
    }
    if (dt < start) {
      // Before working hours — snap to today's start
      return dayStart(dt).toUTC().toISO();
    }
    // After 18:30 — fall through to advance to next working day
  }

  // Advance to next calendar day until we find a working day
  dt = dt.plus({ days: 1 });
  while (!isWorkingDay(dt, holidays)) {
    dt = dt.plus({ days: 1 });
  }
  return dayStart(dt).toUTC().toISO();
}

/**
 * addWorkingMinutes(startIso, minutes, holidays) -> ISO string
 *
 * Adds `minutes` working minutes to `startIso`.
 * `startIso` MUST already be a working-hours moment (i.e., the output of
 * nextWorkingStart or a reply timestamp within working hours).
 * If start is outside working hours, it is clamped to nextWorkingStart first.
 *
 * Algorithm:
 *   1. Clamp start to nextWorkingStart
 *   2. Compute remaining minutes in that day
 *   3. If minutes <= remaining: advance within that day
 *   4. Else: subtract remaining, advance to next working day, repeat
 */
export function addWorkingMinutes(startIso, minutes, holidays = []) {
  let dt = toLuxonIst(startIso);

  // Clamp to working start if needed
  dt = DateTime.fromISO(nextWorkingStart(dt, holidays), { zone: 'utc' }).setZone(IST);

  let remaining = minutes;

  while (remaining > 0) {
    const end = dayEnd(dt);
    const minutesLeftToday = end.diff(dt, 'minutes').minutes;

    if (remaining <= minutesLeftToday) {
      dt = dt.plus({ minutes: remaining });
      remaining = 0;
    } else {
      remaining -= minutesLeftToday;
      // Advance to next working day start
      dt = dt.plus({ days: 1 });
      while (!isWorkingDay(dt, holidays)) {
        dt = dt.plus({ days: 1 });
      }
      dt = dayStart(dt);
    }
  }

  return dt.toUTC().toISO();
}

/**
 * workingMinutesBetween(aIso, bIso, holidays) -> number
 *
 * Counts working minutes in [a, b].
 * If a > b, returns 0.
 * Outside-hours portions are excluded automatically.
 *
 * Used to: compute elapsed time for SLA, compute paused working minutes.
 */
export function workingMinutesBetween(aIso, bIso, holidays = []) {
  let a = toLuxonIst(aIso);
  let b = toLuxonIst(bIso);

  if (a >= b) return 0;

  let total = 0;
  let current = a;

  while (current < b) {
    // If current is not a working day, advance to next working day start
    if (!isWorkingDay(current, holidays)) {
      current = current.plus({ days: 1 }).set({ hour: WORK_START.hour, minute: WORK_START.minute, second: 0, millisecond: 0 });
      continue;
    }

    const wStart = dayStart(current);
    const wEnd   = dayEnd(current);

    // Clamp current to [wStart, wEnd]
    const effectiveStart = current < wStart ? wStart : (current > wEnd ? null : current);
    if (!effectiveStart) {
      // current is after working hours; jump to next day
      current = current.plus({ days: 1 }).set({ hour: WORK_START.hour, minute: WORK_START.minute, second: 0, millisecond: 0 });
      continue;
    }

    const effectiveEnd = b < wEnd ? b : wEnd;
    if (effectiveStart < effectiveEnd) {
      total += effectiveEnd.diff(effectiveStart, 'minutes').minutes;
    }

    // Move to next day
    current = current.plus({ days: 1 }).set({ hour: WORK_START.hour, minute: WORK_START.minute, second: 0, millisecond: 0 });
  }

  return total;
}

/**
 * urgentResolutionDeadline(startIso, holidays) -> ISO string
 *
 * Urgent resolution = end of the SAME working day (18:30 IST).
 * If ticket was created outside working hours, it's the next working day's 18:30.
 * "Same working day" = the working day on which the SLA clock starts.
 */
export function urgentResolutionDeadline(createdAtIso, holidays = []) {
  const start = DateTime.fromISO(nextWorkingStart(createdAtIso, holidays), { zone: 'utc' }).setZone(IST);
  return dayEnd(start).toUTC().toISO();
}
