// Same options as the check on public.studios.change_notice_hours.
export const CHANGE_NOTICE_OPTIONS = [2, 4, 6, 12, 24, 48];

export function changeNoticeHours(source) {
  const hours = Number(source?.change_notice_hours);
  return CHANGE_NOTICE_OPTIONS.includes(hours) ? hours : 2;
}

export const changeNoticeLabel = (source) => `${changeNoticeHours(source)} horas`;

const changeDeadline = (booking) =>
  new Date(booking.starts_at).getTime() - changeNoticeHours(booking) * 60 * 60 * 1000;

export function canManageBooking(booking, now = Date.now()) {
  return booking.status === "confirmed" && booking.paid === false &&
    changeDeadline(booking) >= now;
}

// Confirmed and unpaid, but inside the studio deadline: only the studio can change it.
export function changeDeadlinePassed(booking, now = Date.now()) {
  const deadline = changeDeadline(booking);
  return booking.status === "confirmed" && booking.paid === false &&
    Number.isFinite(deadline) && deadline < now;
}
