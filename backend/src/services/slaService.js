/**
 * SLA Service
 * Computes deadlines, checks breach status, handles pause/resume,
 * priority changes, auto-close, and reopen window.
 *
 * Uses the pure workingHours module + injects DB via sequelize.
 */
import { DateTime } from 'luxon';
import {
  addWorkingMinutes,
  workingMinutesBetween,
  nextWorkingStart,
  urgentResolutionDeadline,
} from '../lib/workingHours.js';
import { SLA_CONFIG, REOPEN_WINDOW_WORKING_MINUTES, AUTO_CLOSE_WORKING_MINUTES } from '../config/constants.js';

/**
 * Fetch all holiday dates from DB as 'YYYY-MM-DD' strings.
 */
export async function getHolidays(sequelize) {
  const [rows] = await sequelize.query('SELECT date FROM holidays');
  return rows.map((r) => {
    // MySQL returns dates as strings or Date objects depending on driver
    const d = r.date;
    return typeof d === 'string' ? d.substring(0, 10) : d.toISOString().substring(0, 10);
  });
}

/**
 * Compute SLA deadlines for a given priority and created_at.
 * Returns { response_due_at, resolution_due_at } as UTC ISO strings.
 *
 * Assumption: "same working day" for urgent = end of the working day
 * on which the SLA clock starts (nextWorkingStart of created_at).
 */
export function computeDeadlines(createdAtIso, priority, holidays = []) {
  const sla = SLA_CONFIG[priority];
  const clockStart = nextWorkingStart(createdAtIso, holidays);
  const response_due_at = addWorkingMinutes(clockStart, sla.firstReply, holidays);

  let resolution_due_at;
  if (priority === 'urgent') {
    resolution_due_at = urgentResolutionDeadline(createdAtIso, holidays);
  } else {
    resolution_due_at = addWorkingMinutes(clockStart, sla.resolution, holidays);
  }

  return { response_due_at, resolution_due_at };
}

/**
 * Compute total WORKING minutes spent in paused state for a ticket.
 * Handles: open pauses (resumed_at = NULL = use now), multiple pauses,
 * pauses spanning weekends/holidays.
 */
export function computePausedMinutes(pauses, holidays = [], nowIso = null) {
  const effectiveNow = nowIso ?? DateTime.utc().toISO();
  let total = 0;
  for (const p of pauses) {
    const start = p.paused_at;
    const end = p.resumed_at ?? effectiveNow;
    total += workingMinutesBetween(start, end, holidays);
  }
  return total;
}

/**
 * Compute effective deadline = base_deadline + paused_working_minutes.
 * This is the adjusted deadline accounting for time the clock was stopped.
 */
export function adjustDeadlineForPauses(baseDeadlineIso, pausedMinutes, holidays = []) {
  if (pausedMinutes <= 0) return baseDeadlineIso;
  return addWorkingMinutes(baseDeadlineIso, pausedMinutes, holidays);
}

/**
 * Is a ticket's response or resolution SLA currently breached?
 * Returns { responseLate, resolutionLate }
 * Pauses are accounted for.
 */
export function checkBreach(ticket, pauses, holidays = [], nowIso = null) {
  const now = nowIso ?? DateTime.utc().toISO();
  const pausedMin = computePausedMinutes(pauses, holidays, now);

  const effectiveResponseDue = adjustDeadlineForPauses(
    ticket.response_due_at,
    // Response SLA only pauses if no reply sent yet
    ticket.first_response_at ? 0 : pausedMin,
    holidays
  );

  const effectiveResolutionDue = adjustDeadlineForPauses(
    ticket.resolution_due_at,
    pausedMin,
    holidays
  );

  const responseLate = !ticket.first_response_at && now > effectiveResponseDue;
  const resolutionLate =
    ticket.status !== 'resolved' &&
    ticket.status !== 'closed' &&
    now > effectiveResolutionDue;

  return { responseLate, resolutionLate, isLate: responseLate || resolutionLate };
}

/**
 * Recompute deadlines after a priority change (Section 2.7).
 * Deadlines are recalculated from the ORIGINAL created_at with the new priority's SLA.
 * If first_response_at is already set, response_due_at is recomputed but the
 * "response SLA breach" is NOT retroactively changed (preserved from old priority).
 *
 * Returns { response_due_at, resolution_due_at }
 */
export function recomputeDeadlinesAfterPriorityChange(ticket, newPriority, holidays = []) {
  return computeDeadlines(ticket.created_at, newPriority, holidays);
}

/**
 * Is a customer allowed to reopen this ticket?
 * Only resolved tickets within 5 working days of resolved_at can be reopened.
 */
export function canReopen(ticket, holidays = [], nowIso = null) {
  if (ticket.status !== 'resolved') {
    return { allowed: false, reason: 'Ticket is not in resolved status.' };
  }
  const now = nowIso ?? DateTime.utc().toISO();
  const minutesSinceResolution = workingMinutesBetween(ticket.resolved_at, now, holidays);
  if (minutesSinceResolution > REOPEN_WINDOW_WORKING_MINUTES) {
    return {
      allowed: false,
      reason: `Reopen window closed (${Math.round(minutesSinceResolution / 60)} working-hours elapsed; limit is 5 working days). Please create a new ticket.`,
    };
  }
  return { allowed: true };
}

/**
 * Should a ticket be auto-closed?
 * Returns true if status = waiting_on_customer and 5+ working days have
 * elapsed since the last pause start (paused_at of the open pause).
 */
export function shouldAutoClose(ticket, pauses, holidays = [], nowIso = null) {
  if (ticket.status !== 'waiting_on_customer') return false;
  const openPause = pauses.find((p) => p.resumed_at === null);
  if (!openPause) return false;
  const now = nowIso ?? DateTime.utc().toISO();
  const waitingMin = workingMinutesBetween(openPause.paused_at, now, holidays);
  return waitingMin >= AUTO_CLOSE_WORKING_MINUTES;
}

/**
 * Compute time remaining on response and resolution SLA (in minutes).
 * Negative = overdue.
 */
export function timeRemaining(ticket, pauses, holidays = [], nowIso = null) {
  const now = nowIso ?? DateTime.utc().toISO();
  const pausedMin = computePausedMinutes(pauses, holidays, now);

  const effectiveResponseDue = adjustDeadlineForPauses(
    ticket.response_due_at,
    ticket.first_response_at ? 0 : pausedMin,
    holidays
  );
  const effectiveResolutionDue = adjustDeadlineForPauses(
    ticket.resolution_due_at,
    pausedMin,
    holidays
  );

  const responseRemaining = workingMinutesBetween(now, effectiveResponseDue, holidays) *
    (now < effectiveResponseDue ? 1 : -1);
  const resolutionRemaining = workingMinutesBetween(now, effectiveResolutionDue, holidays) *
    (now < effectiveResolutionDue ? 1 : -1);

  return { responseRemaining, resolutionRemaining };
}
