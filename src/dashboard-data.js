// Keyset pagination avoids the Data API's implicit row cap and unstable offsets.
export async function readAllPages(makeQuery, query, pageSize = 500) {
  const rows = [];
  let cursor;
  for (let page = 0; page < 200; page++) {
    let request = makeQuery().order("id").limit(pageSize);
    if (cursor) request = request.gt("id", cursor);
    const batch = await query(request);
    if (!Array.isArray(batch))
      throw new Error("Não foi possível carregar os registros.");
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    const next = batch.at(-1)?.id;
    if (!next || next === cursor)
      throw new Error("Não foi possível continuar a consulta.");
    cursor = next;
  }
  throw new Error(
    "Este histórico é muito grande para carregar de uma vez. Entre em contato com o suporte.",
  );
}

export function createDashboardLoader({ supabase, query, rpc, ownerId }) {
  let inFlight,
    studio,
    version,
    lastPoll = 0;
  async function load(force) {
    if (!force && Date.now() - lastPoll < 15000) return null;
    if (studio && !force) {
      const next = await rpc("dashboard_revision", { p_studio: studio.id });
      lastPoll = Date.now();
      if (next === version) return null;
    }
    const s = await query(
      supabase
        .from("studios")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle(),
    );
    if (!s) {
      studio = null;
      version = undefined;
      return { studio: null };
    }
    const nextVersion = await rpc("dashboard_revision", { p_studio: s.id });
    const all = (table, projection = "*", customize = (x) => x) =>
      readAllPages(
        () =>
          customize(
            supabase.from(table).select(projection).eq("studio_id", s.id),
          ),
        query,
      );
    const [clients, services, appointments, payments, professionals] =
      await Promise.all([
        all("clients", "*", (q) => q.is("merged_into", null)),
        all("services"),
        all("appointments", "*, clients(name,phone,email)"),
        all("payments"),
        all("professionals"),
      ]);
    studio = s;
    version = nextVersion;
    lastPoll = Date.now();
    return {
      studio: s,
      clients: clients.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      services: services.sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
      appointments: appointments.sort((a, b) =>
        a.starts_at.localeCompare(b.starts_at),
      ),
      payments,
      professionals: professionals.sort(
        (a, b) =>
          Number(b.is_default) - Number(a.is_default) ||
          a.name.localeCompare(b.name, "pt-BR"),
      ),
    };
  }
  return {
    async load(force = false) {
      if (inFlight) {
        if (!force) return inFlight;
        await inFlight.catch(() => {});
        // A write finished during a poll: ensure one fresh read after it.
        return this.load(true);
      }
      inFlight = load(force).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

export function indexClientVisits(appointments, now = Date.now()) {
  const result = new Map();
  for (const a of appointments) {
    const entry = result.get(a.client_id) || { completed: [], next: null };
    if (a.status === "completed") entry.completed.push(a);
    if (
      a.status === "confirmed" &&
      Date.parse(a.starts_at) >= now &&
      (!entry.next || a.starts_at < entry.next.starts_at)
    )
      entry.next = a;
    result.set(a.client_id, entry);
  }
  return result;
}
