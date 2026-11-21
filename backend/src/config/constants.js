// SLA configuration constants
// Working day = Mon-Fri 09:30-18:30 IST = 540 working minutes
export const WORKING_START_HOUR = 9;
export const WORKING_START_MINUTE = 30;
export const WORKING_END_HOUR = 18;
export const WORKING_END_MINUTE = 30;
export const WORKING_MINUTES_PER_DAY = 540; // 9h * 60
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

// SLA in working minutes
// Assumption: values taken verbatim from brief
export const SLA_CONFIG = {
  urgent: {
    firstReply: 120,       // 2 working hours
    resolution: null,      // "end of same working day" = special logic
  },
  medium: {
    firstReply: 270,       // half day
    resolution: 1620,      // 3 working days
  },
  low: {
    firstReply: 540,       // 1 working day
    resolution: 2700,      // 5 working days
  },
};

// Auto-close after 5 working days with no customer reply
export const AUTO_CLOSE_WORKING_DAYS = 5;
export const AUTO_CLOSE_WORKING_MINUTES = AUTO_CLOSE_WORKING_DAYS * WORKING_MINUTES_PER_DAY; // 2700

// Reopen window: 5 working days from resolved_at
export const REOPEN_WINDOW_WORKING_MINUTES = 5 * WORKING_MINUTES_PER_DAY; // 2700

// Auto-close cron: every 5 minutes
export const AUTO_CLOSE_CRON = '*/5 * * * *';
