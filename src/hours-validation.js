export const weekdays = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

// Mirrors the CHECKs on working_hours/professional_hours, so the owner sees
// which day is wrong instead of a database constraint failure.
const minutes = (value) => {
  const match = /^(\d{2}):(\d{2})/.exec(value || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const clock = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const hhmm = (value) => (value || "").slice(0, 5);

// A new break starts at lunch when it fits; otherwise it is centered in the day.
export function defaultBreak(opens, closes) {
  const start = minutes(opens),
    end = minutes(closes);
  if (start === null || end === null || end - start <= 15 || (start <= 720 && end >= 780))
    return { break_start: "12:00", break_end: "13:00" };
  const length = end - start >= 120 ? 60 : 15;
  const begin = start + Math.floor((end - start - length) / 2 / 15) * 15;
  return { break_start: clock(begin), break_end: clock(begin + length) };
}

function dayProblem(h) {
  const day = weekdays[h.weekday] || "Um dos dias";
  const opens = minutes(h.opens),
    closes = minutes(h.closes);
  if (opens === null || closes === null)
    return `${day}: preencha o horário de início e de fim do atendimento.`;
  if (closes <= opens)
    return `${day}: o fim do atendimento precisa ser depois do início.`;
  if (h.break_start == null && h.break_end == null) return null;
  const start = minutes(h.break_start),
    end = minutes(h.break_end);
  if (start === null || end === null)
    return `${day}: preencha o início e o fim da pausa, ou desmarque a pausa.`;
  if (end <= start) return `${day}: o fim da pausa precisa ser depois do início.`;
  if (start < opens || end > closes)
    return `${day}: a pausa (${hhmm(h.break_start)}–${hhmm(h.break_end)}) precisa ficar dentro do atendimento (${hhmm(h.opens)}–${hhmm(h.closes)}).`;
  return null;
}

// Returns { hours } ready for save_hours/save_professional_hours, or { error }.
// Closed days are not editable on screen, so a stale break is dropped there
// instead of blocking the save; their times never create free slots.
export function prepareHours(hours) {
  if (!Array.isArray(hours) || hours.length !== 7)
    return { error: "Informe os sete dias da semana." };
  const rows = [];
  for (const h of hours) {
    let row = {
      weekday: h.weekday,
      enabled: !!h.enabled,
      opens: hhmm(h.opens),
      closes: hhmm(h.closes),
      break_start: h.break_start == null ? null : hhmm(h.break_start),
      break_end: h.break_end == null ? null : hhmm(h.break_end),
    };
    if (!row.enabled) {
      if (dayProblem({ ...row, break_start: null, break_end: null }))
        row = { ...row, opens: "09:00", closes: "18:00" };
      if (dayProblem(row)) row = { ...row, break_start: null, break_end: null };
    }
    const error = dayProblem(row);
    if (error) return { error };
    rows.push(row);
  }
  return { hours: rows };
}
