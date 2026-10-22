// WAHA (WhatsApp HTTP API) adapter. Receptive by design: it only delivers what the queue
// already approved (reply window, consent, 08:00–20:00) and never starts conversations itself.
const encoder = new TextEncoder();
const SESSION = /^[A-Za-z0-9_-]{1,64}$/;
const ACKS = { "-1": "failed", 1: "sent", 2: "delivered", 3: "read", 4: "read" };

// WAHA signs the raw body with HMAC-SHA512 (X-Webhook-Hmac, hex). subtle.verify compares in constant time.
export async function verifyWahaSignature(raw, signature, algorithm, secret) {
  if (!secret || secret.length < 32 || algorithm !== "sha512" || !/^[0-9a-f]{128}$/.test(signature || "")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["verify"]);
  const bytes = new Uint8Array(signature.match(/../g).map((pair) => parseInt(pair, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(raw));
}

// The same message comes as true_<phone>@c.us_<KEY> from sendText and as true_<lid>@lid_<KEY>
// in receipts (seen 21/10 with GOWS). Only the WhatsApp key is stable, so ids are stored by it.
export const wahaKey = (id) => {
  const match = /^(true|false)_[^_]+_([0-9A-Za-z]+)(_|$)/.exec(typeof id === "string" ? id : "");
  return match ? `waha:${match[2]}` : id;
};

// Translate a WAHA event into the envelope the durable inbox already understands, keeping only
// what the conversation needs. Delivery-specific fields (event id, send time) stay out, so a
// redelivered message yields the same envelope and the same idempotency key.
export function wahaEvent(body) {
  if (!body || typeof body !== "object" || !SESSION.test(body.session || "")) return null;
  const p = body.payload || {};
  const seconds = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? String(Math.floor(n > 1e12 ? n / 1000 : n)) : null;
  };
  const envelope = (value) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages",
    value: { metadata: { phone_number_id: `waha:${body.session}` }, ...value } }] }] });
  if (typeof p.id !== "string" || !p.id || p.id.length > 200) return null;
  if (body.event === "message" || body.event === "message.any") {
    // Only direct chats. WhatsApp now addresses many contacts by a hidden id (@lid); the phone
    // then comes in the engine's alternate address (GOWS: Info.SenderAlt/RecipientAlt, NOWEB:
    // key.remoteJidAlt). Groups and broadcasts are ignored.
    const phone = (jid) => /^([1-9][0-9]{7,14})@(c\.us|s\.whatsapp\.net)$/.exec(jid || "")?.[1];
    const lid = (jid) => /^([0-9]{6,20})@lid$/.exec(jid || "")?.[1];
    const info = p._data?.Info, alt = p._data?.key?.remoteJidAlt;
    const timestamp = seconds(p.timestamp);
    const text = typeof p.body === "string" && p.body.trim() ? p.body.slice(0, 4096) : "[Mensagem não textual]";
    if (!timestamp || info?.IsGroup === true) return null;
    if (p.fromMe) {
      // Sent from the studio's own number: Clara's echo or a reply typed on the phone. Only
      // message.any carries these; the database keeps them for conversations the client opened.
      if (body.event !== "message.any") return null;
      const to = phone(p.to) || (lid(p.to) ? phone(info?.RecipientAlt) || phone(alt) : null), hidden = lid(p.to) || lid(info?.Chat);
      if (!to && !hidden) return null;
      return envelope({ echoes: [{ id: wahaKey(p.id), ...(to && { to }), ...(hidden && { lid: hidden }), timestamp, text: { body: text } }] });
    }
    const hidden = lid(p.from);
    const from = phone(p.from) || (hidden ? phone(info?.SenderAlt) || phone(alt) : null);
    if (!from) return null;
    return envelope({ messages: [{ id: wahaKey(p.id), from, ...(hidden && { lid: hidden }), timestamp, text: { body: text } }] });
  }
  if (body.event === "message.ack") {
    const status = ACKS[p.ack], timestamp = seconds(body.timestamp) || seconds(Date.now());
    if (!status) return null;
    return envelope({ statuses: [{ id: wahaKey(p.id), status, timestamp }] });
  }
  return null;
}

export function wahaBase(env) {
  try {
    const url = new URL(env.WAHA_URL || "");
    const local = ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch { return null; }
}

// Roughly the time a person takes to type the text, kept short for the worker's time budget.
export const typingDelay = (text = "") => Math.min(4000, 1000 + 25 * String(text).length);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function wahaSender(env, request = fetch, wait = pause) {
  return async (job, payload) => {
    // Same independent gates as Meta; delivered with all of them off.
    if (env.WHATSAPP_MODE !== "live" || env.WHATSAPP_LIVE_ENABLED !== "true" || job.mode !== "live" || job.provider !== "waha") return { result: "failed", error: "live_disabled" };
    const base = wahaBase(env), session = /^waha:([A-Za-z0-9_-]{1,64})$/.exec(job.channel || "")?.[1];
    if (!base || !session || (env.WAHA_API_KEY || "").length < 16 || !/^[1-9][0-9]{7,14}$/.test(job.phone || "") || !payload?.text) return { result: "failed", error: "provider_not_configured" };
    const call = (path, extra, ms) => request(`${base}/api/${path}`, {
      method: "POST", headers: { "X-Api-Key": env.WAHA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ session, chatId: `${job.phone}@c.us`, ...extra }), signal: AbortSignal.timeout(ms),
    });
    // Seen and typing are courtesy signals: their failure never blocks or repeats the message.
    try { await call("sendSeen", {}, 5000); } catch { /* ignored */ }
    try { await call("startTyping", {}, 5000); } catch { /* ignored */ }
    await wait(typingDelay(payload.text));
    try {
      const response = await call("sendText", { text: payload.text, linkPreview: false }, 15000);
      const data = await response.json().catch(() => null);
      const id = typeof data?.id === "string" ? data.id : data?.id?._serialized || data?.key?.id;
      if (response.ok && typeof id === "string" && id) return { result: "accepted", provider: wahaKey(id) };
      // Only an explicit rejection is retryable. A timeout/5xx may have sent the message.
      if (response.status === 429) return { result: "retry", error: "provider_rate_limit" };
      if (response.status >= 500 || response.ok) return { result: "uncertain", error: "provider_result_unknown" };
      return { result: "failed", error: `waha_${response.status}` };
    } catch { return { result: "uncertain", error: "provider_result_unknown" }; }
  };
}
