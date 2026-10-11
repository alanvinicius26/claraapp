export function canManageBooking(booking, now = Date.now()) {
  return booking.status === "confirmed" && booking.paid === false &&
    new Date(booking.starts_at).getTime() >= now + 2 * 60 * 60 * 1000;
}
