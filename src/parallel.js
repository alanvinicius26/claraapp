export const PARALLEL_MIN = 2;
export const PARALLEL_MAX = 10;

// Form values -> service columns. A hidden limit keeps the previous setting.
export function parallelServiceData(f, item) {
  const allows = f.allows_parallel === "on";
  const limit = Number(f.parallel_limit);
  return {
    allows_parallel: allows,
    parallel_limit:
      allows && Number.isInteger(limit)
        ? Math.min(PARALLEL_MAX, Math.max(PARALLEL_MIN, limit))
        : item?.parallel_limit ?? PARALLEL_MIN,
  };
}

// Ids of active appointments served together with another one by the same
// professional (service time overlap; cleanup does not count as company).
export function sharedAppointmentIds(appointments) {
  const active = appointments
    .filter((a) => a.status === "confirmed" || a.status === "completed")
    .map((a) => ({ a, start: Date.parse(a.starts_at), end: Date.parse(a.ends_at) }));
  const ids = new Set();
  for (const x of active)
    for (const y of active)
      if (x.a.id !== y.a.id && x.a.professional_id === y.a.professional_id && x.start < y.end && y.start < x.end)
        ids.add(x.a.id);
  return ids;
}
