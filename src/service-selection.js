export function summarizeServices(services) {
  return {
    duration: services.reduce((n, s) => n + Number(s.duration), 0),
    price:
      services.reduce((n, s) => n + Math.round(Number(s.price) * 100), 0) / 100,
    name: services.map((s) => s.name).join(" + "),
  };
}

export function serviceSchedule(services, startsAt, buffer = 0) {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return null;
  let cursor = start;
  const items = services.map((service) => {
    const from = cursor;
    cursor += Number(service.duration) * 60000;
    return {
      ...service,
      starts_at: new Date(from).toISOString(),
      ends_at: new Date(cursor).toISOString(),
    };
  });
  return {
    items,
    ends_at: new Date(cursor).toISOString(),
    free_at: new Date(cursor + Number(buffer) * 60000).toISOString(),
  };
}
