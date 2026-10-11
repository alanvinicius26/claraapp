import { shiftDate } from "./domain.js";

// Bound each search so a full agenda does not exhaust the public API quota.
export async function findNextDates({ after, until, fetchRange, isCurrent = () => true }) {
  if (!isCurrent()) return null;
  if (shiftDate(after, 1) > until) return { dates: [], through: after, hasMore: false };
  const result = await fetchRange(after, until);
  return isCurrent() ? result : null;
}
