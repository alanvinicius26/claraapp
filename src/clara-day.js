const timezone = "America/Sao_Paulo";
export function agendaDay(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

export function claraDaySummary(appointments, { day, professionalId = "", now = new Date() }) {
  const current = new Date(now);
  const today = agendaDay(current);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", hourCycle: "h23",
  }).format(current));
  const scoped = appointments.filter(a =>
    (!professionalId || a.professional_id === professionalId) &&
    ["confirmed", "completed"].includes(a.status) &&
    Number.isFinite(Date.parse(a.starts_at)),
  );
  const selected = scoped.filter(a => agendaDay(a.starts_at) === day);
  const next = scoped.filter(a => a.status === "confirmed" && new Date(a.starts_at) >= current)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
  const date = new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    timeZone: timezone, day: "numeric", month: "long",
  });
  const count = selected.length;
  const period = day === today ? "Hoje" : `Em ${date}`;
  return {
    greeting: hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite",
    count,
    completed: selected.filter(a => a.status === "completed").length,
    summary: count ? `${period}, você tem ${count} atendimento${count === 1 ? "" : "s"}.` : `${period}, sua agenda está livre.`,
    next,
    nextDay: next ? agendaDay(next.starts_at) : null,
    nextLabel: next ? `${agendaDay(next.starts_at) === today ? "Hoje" : new Date(next.starts_at).toLocaleDateString("pt-BR", {timeZone: timezone, day: "2-digit", month: "2-digit"})} às ${new Date(next.starts_at).toLocaleTimeString("pt-BR", {timeZone: timezone, hour: "2-digit", minute: "2-digit"})}` : null,
  };
}
