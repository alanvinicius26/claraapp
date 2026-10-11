// Manual browser QA only. No real session, external fetch or business writes.
window.fetch = async () => { throw new Error("External network blocked in scheduling fixture"); };
const { supabase } = await import("../src/lib.js");
const { demoStudio, demoProfessionals, demoClients, demoServices } = await import("../src/demo.js");
const { studioInstant } = await import("../src/scheduling.js");
supabase.auth.stopAutoRefresh();
const session = { access_token: "synthetic", user: { id: "qa-owner" } };
supabase.auth.getSession = async () => ({ data: { session } });
supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
const studioId = "qa-scheduling";
const records = {
  studios: [{ ...demoStudio, id: studioId, owner_id: "qa-owner", buffer: 10 }],
  clients: demoClients.map((x) => ({ ...x, studio_id: studioId })),
  services: demoServices.map((x) => ({ ...x, studio_id: studioId, created_at: "2026-01-01", resource_id: "maca1" })),
  professionals: demoProfessionals.map((x) => ({ ...x, studio_id: studioId })),
  resources: [{ id: "maca1", studio_id: studioId, name: "Maca 1", active: true }],
  appointments: [], payments: [], working_hours: [], professional_hours: [],
};
let conflictOnce = true;
supabase.rpc = async (name, args) => ({ data: name === "billing_status" ? { can_use: true, billing_enabled: false } :
  name === "owner_available_slots" ? (conflictOnce ? ["09:00", "13:00"] : ["13:00"]).map((clock) => ({ starts_at: studioInstant(args.p_date, clock) })) : 1, error: null });
supabase.from = (table) => {
  let operation = "read", payload, single = false;
  const filters = [];
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(k, v) { filters.push((x) => x[k] === v); return q; },
    is(k, v) { filters.push((x) => v === null ? x[k] == null : x[k] === v); return q; },
    gt(k, v) { filters.push((x) => x[k] > v); return q; },
    single() { single = true; return q; }, maybeSingle() { single = true; return q; },
    insert(v) { operation = "insert"; payload = v; return q; }, update(v) { operation = "update"; payload = v; return q; },
    then(resolve, reject) {
      if (table === "appointments" && operation !== "read" && conflictOnce) {
        conflictOnce = false;
        return Promise.resolve({ data: null, error: { code: "23P01", message: "exclusion conflict" } }).then(resolve, reject);
      }
      let data = (records[table] || []).filter((x) => filters.every((f) => f(x)));
      if (operation === "insert") {
        const row = { id: crypto.randomUUID(), ...payload };
        if (table === "resources") row.active = true;
        if (table === "appointments") {
          const items = records.services.filter((s) => row.service_ids.includes(s.id));
          Object.assign(row, { service_items: items, service_name: items.map((s) => s.name).join(" + "),
            price: items.reduce((n, s) => n + Number(s.price), 0), clients: records.clients.find((c) => c.id === row.client_id),
            ends_at: new Date(Date.parse(row.starts_at) + items.reduce((n, s) => n + s.duration, 0) * 60000).toISOString() });
        }
        records[table].push(row); data = [row];
      }
      if (operation === "update") data.forEach((row) => Object.assign(row, payload));
      return Promise.resolve({ data: structuredClone(single ? data[0] || null : data), error: null }).then(resolve, reject);
    },
  };
  return q;
};
await import("../src/main.jsx");
