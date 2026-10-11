export const STUDIO_TIME_ZONE = "America/Sao_Paulo";

// Convert studio wall time to an instant without depending on the device zone
// or a hard-coded UTC offset. Reject nonexistent/ambiguous DST wall times.
export function studioInstant(date, clock, zone = STUDIO_TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock))
    throw new Error("Informe uma data e um horário válidos.");
  const wall = Date.parse(`${date}T${clock}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${date}T${clock}`)
    throw new Error("Informe uma data e um horário válidos.");
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const local = (instant) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => {
    const instant = wall + delta;
    return Date.parse(`${local(instant)}:00Z`) - instant;
  }));
  const matches = [...offsets].map((offset) => wall - offset).filter((instant) => local(instant) === `${date}T${clock}`);
  if (matches.length !== 1) throw new Error("Este horário muda com o fuso. Escolha outro horário.");
  return new Date(matches[0]).toISOString();
}

export function sameInstant(left, right) {
  return Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
}

export function hasSlot(slots, instant) {
  return slots.some((slot) => sameInstant(slot.starts_at, instant));
}
