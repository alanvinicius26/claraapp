// Owner alerts for client actions. The panel decides WHAT to say here; HOW it is
// delivered (browser today, Capacitor local/push notifications later) lives only
// in createAlertDelivery, so a native app swaps that single adapter.
const zone = "America/Sao_Paulo";
const when = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const d = new Date(value);
  const weekday = d.toLocaleDateString("pt-BR", { timeZone: zone, weekday: "short" });
  const day = d.toLocaleDateString("pt-BR", { timeZone: zone, day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  return `${weekday}, ${day} às ${time}`;
};

export function alertText({ kind, payload = {} }) {
  const who = [payload.client || "Cliente", payload.service || "Atendimento"];
  if (kind === "client_cancelled")
    return { title: "Reserva cancelada pela cliente", body: [...who, when(payload.starts_at)].filter(Boolean).join(" · ") };
  if (kind === "client_rescheduled")
    return {
      title: "Reserva remarcada pela cliente",
      body: [...who, `agora ${when(payload.starts_at)}`].join(" · ") +
        (payload.previous_starts_at ? ` (antes ${when(payload.previous_starts_at)})` : ""),
    };
  return { title: "Nova reserva", body: [...who, when(payload.starts_at)].filter(Boolean).join(" · ") };
}

export function unseenTitle(title, count) {
  const base = String(title || "").replace(/^\(\d+\+?\)\s*/, "");
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
}

const prefsKey = (studio) => `clara-alerts:${studio}`;
// Per device: sound matters on the computer at the reception, not on every phone.
export function loadAlertPrefs(studio, storage) {
  try {
    const saved = JSON.parse(storage?.getItem(prefsKey(studio)) || "null");
    return { sound: saved?.sound !== false };
  } catch {
    return { sound: true };
  }
}
export function saveAlertPrefs(studio, prefs, storage) {
  try { storage?.setItem(prefsKey(studio), JSON.stringify({ sound: !!prefs.sound })); } catch { /* Preference stays in memory. */ }
}

// Newer data for the same event (e.g. seen_at) replaces the older copy.
export function mergeAlerts(current, incoming, limit = 30) {
  const byId = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) byId.set(x.id, { ...byId.get(x.id), ...x });
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

// Decides which events deserve sound/message. The first read only records the
// backlog; a real-time event that arrives while that read is in flight is held and
// announced right after it, instead of being silently absorbed into the backlog.
export function createAlertTracker() {
  const known = new Set(), early = new Map();
  let ready = false;
  const fresh = (rows) => {
    const list = rows.filter((r) => !known.has(r.id));
    list.forEach((r) => known.add(r.id));
    return list;
  };
  return {
    get ready() { return ready; },
    // Real-time insert or simulated event.
    incoming(rows) {
      if (!ready) { rows.forEach((r) => early.set(r.id, r)); return []; }
      return fresh(rows);
    },
    // Result of a catch-up read (newest first, as queried).
    loaded(rows) {
      if (ready) return fresh(rows.filter((r) => !r.seen_at).reverse());
      rows.forEach((r) => { if (!early.has(r.id)) known.add(r.id); });
      ready = true;
      const held = [...early.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      early.clear();
      return fresh(held);
    },
  };
}

// Short two-tone chime generated on the fly: no audio file to download or cache.
export function playChime(win = globalThis) {
  try {
    const Context = win.AudioContext || win.webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    [880, 1320].forEach((frequency, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.16;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start); osc.stop(start + 0.32);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch { /* Browsers may block audio until the page receives a click. */ }
}

export function createAlertDelivery({ document: doc = globalThis.document, Notification: Native = globalThis.Notification, playSound = playChime } = {}) {
  return (text, prefs) => {
    if (prefs?.sound) playSound();
    // While the panel is visible the on-screen message is enough.
    if (!doc?.hidden || !Native || Native.permission !== "granted") return;
    try { new Native(text.title, { body: text.body, tag: "clara-alert", icon: "/clara-icon-v3.png" }); }
    catch { /* Some mobile browsers only allow notifications from a service worker. */ }
  };
}

// Demonstration only: recent online bookings shown as if they had just arrived.
export function demoAlerts(appointments, now = Date.now()) {
  return appointments
    .filter((a) => a.source === "online" && a.status === "confirmed" && Date.parse(a.starts_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3)
    .map((a, i) => ({
      id: `demo-alert-${a.id}`, kind: "new_booking", appointment_id: a.id,
      created_at: new Date(now - (4 + i * 23) * 60000).toISOString(),
      seen_at: i < 2 ? null : new Date(now).toISOString(),
      payload: { client: a.clients?.name, service: a.service_name, starts_at: a.starts_at },
    }));
}

export const browserNotificationState =(Native = globalThis.Notification) =>
  !Native ? "unsupported" : Native.permission;
