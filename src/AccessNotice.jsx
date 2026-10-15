import React, { useCallback, useEffect, useRef, useState } from "react";
import { Lock, ArrowRight } from "lucide-react";
import { rpc } from "./lib";
import ClaraArt from "./ClaraArt";
import { accessNotice, nextAccessCheck, noticeSeenKey } from "./access-notice";
import "./access-notice.css";

let session;
try { session = window.sessionStorage; } catch { /* Shown every time instead. */ }
const seen = (key) => { try { return session?.getItem(key) === "1"; } catch { return false; } };
const markSeen = (key) => { try { session?.setItem(key, "1"); } catch { /* In memory only. */ } };

// Read-only mode after the trial/plan ends: the database already blocks writes and
// new online bookings; this explains why and leads to the subscription screen.
// `previewStatus`: local development preview only (no network).
export default function AccessNotice({ ownerId, page, prefix, previewStatus }) {
  const [status, setStatus] = useState(previewStatus || null);
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef(null);
  const load = useCallback(async () => {
    if (previewStatus) return;
    try { setStatus(await rpc("billing_status")); } catch { /* Keep the last known state. */ }
  }, [previewStatus]);

  useEffect(() => { load(); }, [load, page]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && navigator.onLine) load(); };
    const timer = setInterval(refresh, 5 * 60000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  // Re-check right when the trial, paid period or admin access ends.
  useEffect(() => {
    const at = nextAccessCheck(status);
    if (!at) return;
    const timer = setTimeout(load, Math.min(at - Date.now() + 3000, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [status, load]);

  const notice = accessNotice(status);
  const onSubscription = page === "assinatura";
  const key = notice && noticeSeenKey(ownerId, notice.kind);
  const showDialog = !!notice && !onSubscription && !dismissed && !seen(key);

  useEffect(() => {
    const el = dialog.current;
    if (showDialog && el && !el.open) el.showModal?.();
  }, [showDialog]);

  if (!notice || onSubscription) return null;
  const close = () => { markSeen(key); setDismissed(true); dialog.current?.close?.(); };
  const go = () => { close(); location.hash = "#" + prefix + "assinatura"; };

  return <>
    <div className="access-banner" role="status">
      <Lock size={16} aria-hidden="true" />
      <span><strong>{notice.title}.</strong> Você pode consultar seus dados, mas novos agendamentos e reservas online estão pausados.</span>
      <button type="button" className="button primary" onClick={go}>{notice.cta} <ArrowRight size={15} /></button>
    </div>
    {showDialog && <dialog ref={dialog} className="modal access-dialog" aria-labelledby="access-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      <ClaraArt className="access-art" pose="reminder" />
      <h2 id="access-title">{notice.title}</h2>
      <p>{notice.body}</p>
      <div className="access-actions">
        <button type="button" className="button primary full" onClick={go} autoFocus>{notice.cta} <ArrowRight size={16} /></button>
        <button type="button" className="text-button" onClick={close}>Agora não, só quero consultar</button>
      </div>
    </dialog>}
  </>;
}
