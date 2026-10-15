// Time and date helpers. Pure functions only.
// Times are "HH:MM" strings (24 h). Dates are local "YYYY-MM-DD" strings.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "09:30" → 570. Returns null when the text is not a valid time. */
export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = HHMM.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 570 → "09:30". */
export function fromMinutes(total) {
  const t = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 90 → "1 h 30 min", 45 → "45 min", 120 → "2 h", 0 → "0 min". */
export function formatMinutes(total) {
  const t = Math.max(0, Math.round(Number(total) || 0));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isValidDate(ymd) {
  if (typeof ymd !== 'string') return false;
  const m = YMD.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Whole days from a to b (b - a). Both YYYY-MM-DD. Timezone-safe. */
export function daysBetween(a, b) {
  const toUTC = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Local today as YYYY-MM-DD. */
export function todayYMD(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Adds n days to a YYYY-MM-DD date. */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Day of week with Monday = 0 … Sunday = 6. */
export function weekdayMon0(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-15" → "Thu, 15 Oct". */
export function formatDate(ymd) {
  if (!isValidDate(ymd)) return '';
  const [, m, d] = ymd.split('-').map(Number);
  return `${WEEKDAYS_SHORT[weekdayMon0(ymd)]}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "2026-10-15" → "October 2026". */
export function formatMonth(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Gentle relative label: "Today", "Tomorrow", "In 5 days", "3 days ago". */
export function relativeDays(fromYmd, toYmd) {
  const n = daysBetween(fromYmd, toYmd);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1) return `In ${n} days`;
  return `${-n} days ago`;
}
