// Isolated browser fixture: modifies demo data in this tab only; never writes to Supabase.
import { demoAppointments, demoClients, demoServices } from "../src/demo.js";
demoAppointments.forEach(appointment => { appointment.status = "completed"; });
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
demoAppointments.push({
  ...demoAppointments[0], id: "clara-upcoming", status: "confirmed",
  starts_at: future.toISOString(), ends_at: new Date(+future + 45 * 60000).toISOString(),
  clients: { ...demoClients[0], name: "Ana Exemplo" },
  service_name: demoServices[0].name,
});
await import("../src/main.jsx");
