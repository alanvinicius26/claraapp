import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellRing, CalendarCheck, CalendarX, CalendarClock } from "lucide-react";
import { supabase, query, rpc } from "./lib";
import { alertText, unseenTitle, loadAlertPrefs, saveAlertPrefs, mergeAlerts, createAlertDelivery, browserNotificationState, createAlertTracker } from "./booking-alerts";
import "./booking-alerts.css";

const icons = { new_booking: CalendarCheck, client_cancelled: CalendarX, client_rescheduled: CalendarClock };
const ago = (value) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `há ${hours} h` : new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
};
let storage;
try { storage = window.localStorage; } catch { /* Preferences stay in memory. */ }

// Real-time alerts for client actions. Polling in the dashboard stays as fallback.
export default function BookingAlerts({ studioId, notify, onChange, onOpen, demoItems }) {
  const demo = Array.isArray(demoItems);
  const [items, setItems] = useState(() => demoItems || []);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => loadAlertPrefs(studioId, storage));
  const [permission, setPermission] = useState(() => browserNotificationState());
  const tracker = useRef(createAlertTracker());
  const prefsRef = useRef(prefs);
  const root = useRef(null);
  const panel = useRef(null);
  const [place, setPlace] = useState(null);
  const deliver = useMemo(() => createAlertDelivery(), []);
  prefsRef.current = prefs;

  // Receives only events the tracker decided are new and worth announcing.
  const announce = useCallback((fresh) => {
    if (!fresh.length) return;
    const text = alertText(fresh[0]);
    notify(fresh.length > 1 ? `${fresh.length} novidades nas reservas. ${text.title}: ${text.body}` : `${text.title}: ${text.body}`);
    deliver(fresh.length > 1 ? { title: `${fresh.length} novidades nas reservas`, body: text.body } : text, prefsRef.current);
    onChange?.();
  }, [deliver, notify, onChange]);

  // Local development only: exercises arrival (message, sound, browser notification)
  // without a database. Delayed so the tester can switch to another tab first.
  const simulate = () => {
    const sample = items.find((i) => i.payload?.starts_at) || { payload: { client: "Cliente de teste", service: "Manicure", starts_at: new Date(Date.now() + 864e5).toISOString() } };
    setOpen(false);
    setTimeout(() => {
      const event = { ...sample, id: `sim-${Date.now()}`, kind: "new_booking", created_at: new Date().toISOString(), seen_at: null };
      if (!tracker.current.ready) tracker.current.loaded([]);
      setItems((current) => mergeAlerts(current, [event]));
      announce(tracker.current.incoming([event]));
    }, 5000);
  };

  // Catch-up read: first load, and after every (re)connection, so nothing is missed.
  const catchUp = useCallback(async () => {
    try {
      const rows = await query(supabase.from("studio_notifications")
        .select("id,kind,payload,created_at,seen_at,appointment_id")
        .eq("studio_id", studioId).order("created_at", { ascending: false }).limit(30));
      setItems((current) => mergeAlerts(current, rows || []));
      announce(tracker.current.loaded(rows || []));
    } catch { /* The bell stays as it was; the next reconnection retries. */ }
  }, [studioId, announce]);

  useEffect(() => {
    if (demo) return;
    tracker.current = createAlertTracker(); setItems([]);
    setPrefs(loadAlertPrefs(studioId, storage));
    catchUp();
    const channel = supabase.channel(`studio-alerts-${studioId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "studio_notifications", filter: `studio_id=eq.${studioId}` }, ({ new: row }) => {
        setItems((current) => mergeAlerts(current, [row]));
        announce(tracker.current.incoming([row]));
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") catchUp(); });
    return () => { supabase.removeChannel(channel); };
  }, [studioId, catchUp, announce, demo]);

  const unseen = items.filter((i) => !i.seen_at).length;
  useEffect(() => {
    document.title = unseenTitle(document.title, unseen);
    return () => { document.title = unseenTitle(document.title, 0); };
  }, [unseen]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !root.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", close); document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
  }, [open]);

  // The topbar uses backdrop-filter, which traps fixed/absolute children in its own
  // layer; the panel is rendered on <body> and anchored to the bell instead.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = root.current?.getBoundingClientRect();
      if (r) setPlace({ top: Math.round(r.bottom + 8), right: Math.max(16, Math.round(window.innerWidth - r.right)) });
    };
    update();
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unseen) {
      const now = new Date().toISOString();
      setItems((current) => current.map((i) => i.seen_at ? i : { ...i, seen_at: now }));
      if (!demo) try { await rpc("mark_notifications_seen", { p_studio: studioId }); } catch { /* Shown as seen here; the server retries next time. */ }
    }
  };
  const changeSound = (sound) => { const next = { ...prefs, sound }; setPrefs(next); saveAlertPrefs(studioId, next, storage); };
  const askPermission = async () => {
    try { setPermission(await window.Notification.requestPermission()); } catch { setPermission(browserNotificationState()); }
  };

  return <div className="booking-alerts" ref={root}>
    <button type="button" className="icon-button alerts-bell" aria-haspopup="dialog" aria-expanded={open}
      aria-label={unseen ? `Avisos de reservas: ${unseen} novo${unseen > 1 ? "s" : ""}` : "Avisos de reservas"} onClick={toggle}>
      {unseen ? <BellRing size={18} /> : <Bell size={18} />}
      {unseen > 0 && <span className="alerts-count" aria-hidden="true">{unseen > 9 ? "9+" : unseen}</span>}
    </button>
    {open && createPortal(<div className="alerts-panel" role="dialog" aria-label="Avisos de reservas" ref={panel}
      style={place ? { top: place.top, right: place.right } : { visibility: "hidden" }}>
      <div className="alerts-head"><strong>Avisos de reservas</strong><small>Reservas, remarcações e cancelamentos feitos pelas clientes.</small></div>
      {items.length ? <ul className="alerts-list">{items.map((item) => {
        const text = alertText(item), Icon = icons[item.kind] || CalendarCheck;
        return <li key={item.id}><button type="button" className={`alert-item ${item.kind}`} onClick={() => { setOpen(false); onOpen?.(item); }}>
          <Icon size={17} aria-hidden="true" />
          <span><strong>{text.title}</strong><span>{text.body}</span><small>{ago(item.created_at)}</small></span>
        </button></li>;
      })}</ul> : <p className="alerts-empty">Quando uma cliente reservar, remarcar ou cancelar pelo link, o aviso aparece aqui na hora.</p>}
      <div className="alerts-settings">
        <label className="check-field"><input type="checkbox" checked={prefs.sound} onChange={(e) => changeSound(e.target.checked)} /> Tocar som neste aparelho</label>
        {permission === "default" && <button type="button" className="text-button" onClick={askPermission}>Avisar mesmo com a aba em segundo plano</button>}
        {permission === "granted" && <small>Avisos do navegador ativados neste aparelho.</small>}
        {permission === "denied" && <small>Os avisos do navegador estão bloqueados. Libere nas configurações do site para recebê-los com a aba em segundo plano.</small>}
        <small>Com o painel fechado não há aviso; ele aparece aqui quando você voltar.</small>
        {import.meta.env.DEV && <button type="button" className="text-button" onClick={simulate}>Simular nova reserva em 5 s (só no ambiente local)</button>}
      </div>
    </div>, document.body)}
  </div>;
}
