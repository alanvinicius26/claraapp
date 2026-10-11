// No real session, backend or writes: exercise the actual forms against an in-memory database.
import { supabase } from "../src/lib.js";
import { demoStudio, demoProfessionals, demoAppointments, demoClients } from "../src/demo.js";
const params = new URL(location.href).searchParams;
const studioId = `qa-clara-${crypto.randomUUID()}`;
const records = {
  studios: [{ ...demoStudio, id: studioId, owner_id: "qa-owner" }],
  professionals: demoProfessionals.map(item => ({ ...item, studio_id: studioId })),
  services: [], payments: [],
  clients: params.has("appointment") ? [{ ...demoClients[0], studio_id: studioId }] : [],
  appointments: params.has("appointment") ? [{ ...demoAppointments[0], studio_id: studioId, status: "confirmed" }] : [],
};
let failOnce = params.has("fail");
const session = { access_token: "synthetic-test", user: { id: "qa-owner" } };
supabase.auth.getSession = async () => ({ data: { session } });
supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
window.fetch = async () => { throw new Error("External network blocked in the isolated fixture"); };
supabase.from = table => {
  let operation = "read", payload, single = false;
  const filters = [];
  const builder = {
    select() { return builder; }, order() { return builder; },
    eq(key, value) { filters.push(item => item[key] === value); return builder; },
    is(key, value) { filters.push(item => value === null ? item[key] == null : item[key] === value); return builder; },
    maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
    insert(value) { operation = "insert"; payload = value; return builder; },
    update(value) { operation = "update"; payload = value; return builder; },
    then(resolve, reject) {
      if (operation !== "read" && failOnce) { failOnce = false; return Promise.resolve({ data: null, error: { message: "Falha simulada ao salvar. Tente novamente." } }).then(resolve, reject); }
      let data = records[table].filter(item => filters.every(filter => filter(item)));
      if (operation === "insert") { const item = { id: crypto.randomUUID(), ...payload }; records[table].push(item); data = [item]; }
      if (operation === "update") data.forEach(item => Object.assign(item, payload));
      return Promise.resolve({ data: structuredClone(single ? data[0] || null : data), error: null }).then(resolve, reject);
    },
  };
  return builder;
};
await import("../src/main.jsx");
