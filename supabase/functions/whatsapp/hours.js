// Active messages leave only from 08:00 to 19:59 in São Paulo.
// Mirrors encaixa_private.whatsapp_in_hours / whatsapp_active (whatsapp_waha.sql).
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function withinSendWindow(date = new Date()) {
  const [hour, minute] = clock.format(date).split(":").map(Number);
  const minutes = hour * 60 + minute;
  return minutes >= 8 * 60 && minutes < 20 * 60;
}
// Replies to a client who just wrote are receptive; everything the studio starts is active.
export function isActiveMessage(job) {
  return ["confirmation", "reschedule", "cancellation", "reminder"].includes(job?.kind) || (job?.kind === "manual" && !!job?.template_key);
}
