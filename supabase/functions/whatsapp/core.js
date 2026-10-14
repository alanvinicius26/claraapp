// Shared by the Edge Function and the isolated local simulator. No generative AI.
const encoder = new TextEncoder();
export function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = encoder.encode(a), y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
export async function verifySignature(raw, signature, secret) {
  if (!secret || !/^sha256=[0-9a-f]{64}$/.test(signature || "")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const hex = [...new Uint8Array(signed)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return equalSecret(signature, "sha256=" + hex);
}
export function originFor(env) {
  const url = new URL(env.APP_ORIGIN || "");
  const local = env.WHATSAPP_MODE === "simulation" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("invalid_origin");
  return url.origin;
}
export function providerPayload(job, origin) {
  const absolute = (s) => String(s).replace(/\/\#\/(manage|booking)\//g, `${origin}/#/$1/`);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: job.phone };
  if (job.use_template) {
    const name = job.template?.name || `clara_${job.template_key}_v1`;
    const parameters = (job.parameters || []).map((value) => ({ type: "text", text: absolute(value) }));
    return { ...base, type: "template", template: { name, language: { code: job.template?.language || "pt_BR" }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) } };
  }
  if (job.kind === 'greeting') return { ...base, type: 'interactive', interactive: {
    type: 'button', body: { text: absolute(job.body) }, action: { buttons: [
      { type: 'reply', reply: { id: 'agendar', title: 'Agendar' } },
      { type: 'reply', reply: { id: 'atendente', title: 'Falar com atendente' } },
    ] },
  } };
  return { ...base, type: "text", text: { preview_url: false, body: absolute(job.body) } };
}
export function simulationSender({ fail = () => null } = {}) {
  return async (job, payload) => {
    const failure = fail(job);
    if (failure) return { result: failure, error: "simulation_injected_failure" };
    return { result: "simulated", provider: `sim:${job.id}` };
  };
}
export function metaSender(env, request = fetch, credentialFor) {
  return async (job, payload) => {
    // Three independent gates. This project is delivered with all live gates off.
    if (env.WHATSAPP_MODE !== "live" || env.WHATSAPP_LIVE_ENABLED !== "true" || job.mode !== "live") return { result: "failed", error: "live_disabled" };
    if (!/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || "") || !/^\d+$/.test(job.channel)) return { result: "failed", error: "provider_not_configured" };
    if (job.use_template && (job.template?.approved !== true || !/^[a-z0-9_]+$/.test(job.template?.name || "") || !job.template?.language)) return { result: "failed", error: "template_required" };
    let token;
    try { token = credentialFor ? await credentialFor(job) : env.META_ACCESS_TOKEN; }
    catch { return { result: 'failed', error: 'connection_required' }; }
    if (!token) return { result: 'failed', error: 'connection_required' };
    try {
      const response = await request(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${job.channel}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (response.ok && typeof data.messages?.[0]?.id === "string") return { result: "accepted", provider: data.messages[0].id };
      // Only an explicit rejection is retryable. A timeout/5xx may have sent the message.
      if (response.status === 429 && data.error) return { result: "retry", error: "provider_rate_limit" };
      if (response.status >= 500 || response.ok) return { result: "uncertain", error: "provider_result_unknown" };
      return { result: "failed", error: `provider_${Number(data.error?.code) || response.status}` };
    } catch { return { result: "uncertain", error: "provider_result_unknown" }; }
  };
}
export async function processQueue({ db, env, send }) {
  const origin = originFor(env);
  const mode = env.WHATSAPP_MODE || "simulation";
  if (!['simulation','live'].includes(mode)) throw new Error("invalid_mode");
  const stats = { processed: 0, simulated: 0, accepted: 0, failed: 0, retry: 0, uncertain: 0 };
  const deadline = Date.now() + 45000;
  for (let i = 0; i < 20 && Date.now() < deadline; i++) {
    const job = await db("whatsapp_claim", { p_mode: mode });
    if (!job) break;
    let result;
    try { result = await send(job, providerPayload(job, origin)); }
    catch { result = { result: "uncertain", error: "provider_result_unknown" }; }
    await db("whatsapp_finish", { p_id: job.id, p_lease: job.lease_id, p_result: result.result, p_provider: result.provider || null, p_error: result.error || null });
    stats.processed++; stats[result.result]++;
  }
  // n8n receives counts only, never customer phone, message body or management token.
  return stats;
}
async function readLimited(req) {
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size = 0, chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new Error("body_too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export function createHandler({ env, db, send }) {
  const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return async (req) => {
    const url = new URL(req.url), action = url.pathname.split("/").filter(Boolean).at(-1);
    if (action === "webhook" && req.method === "GET") {
      if (url.searchParams.get("hub.mode") !== "subscribe" || !equalSecret(url.searchParams.get("hub.verify_token"), env.META_VERIFY_TOKEN)) return respond({ error: "unauthorized" }, 403);
      return new Response(url.searchParams.get("hub.challenge") || "", { headers: { "Cache-Control": "no-store" } });
    }
    if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
    if (action !== "webhook" && !equalSecret(req.headers.get("authorization"), `Bearer ${env.CLARA_N8N_SECRET || ""}`)) return respond({ error: "unauthorized" }, 401);
    if (action !== "webhook" && (env.CLARA_N8N_SECRET || "").length < 32) return respond({ error: "integration_not_configured" }, 503);
    try {
      const raw = await readLimited(req);
      if (action === "webhook" && !await verifySignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) return respond({ error: "invalid_signature" }, 401);
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { return respond({ error: "invalid_json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "invalid_event" }, 400);
      if (action === 'inbox') return respond(await db('whatsapp_dispatch', {p_mode: env.WHATSAPP_MODE || 'simulation'}));
      if (action === 'health' || action === 'incident') return respond(await db('whatsapp_operations', {p_mode: env.WHATSAPP_MODE || 'simulation',p_record:action==='incident'}));
      if (action === "process") {
        if(env.WHATSAPP_MODE==='live' && env.WHATSAPP_LIVE_ENABLED!=='true')return respond({error:'live_disabled'},503);
        await db('whatsapp_dispatch', {p_mode: env.WHATSAPP_MODE || 'simulation'});
        return respond(await processQueue({ db, env, send }));
      }
      if (action === "simulate-inbound") {
        if (env.WHATSAPP_MODE !== "simulation") return respond({ error: "simulation_disabled" }, 403);
        const { channel, event_id, phone, text, timestamp } = body;
        if (![channel,event_id,phone,text].every((v) => typeof v === "string") || !Number.isFinite(Date.parse(timestamp))) return respond({ error: "invalid_event" }, 400);
        const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:channel},
          messages:[{id:event_id,from:phone,text:{body:text},timestamp:String(Math.floor(Date.parse(timestamp)/1000))}]}}]}]};
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(payload)))),v=>v.toString(16).padStart(2,'0')).join('');
        return respond(await db('whatsapp_ingest',{p_key:hash,p_payload:payload,p_mode:'simulation'}));
      }
      if (action === "webhook") {
        if (env.WHATSAPP_MODE !== "live") return respond({ error: "live_disabled" }, 403);
        if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return respond({ error: "invalid_event" }, 400);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw))),v=>v.toString(16).padStart(2,'0')).join('');
        return respond(await db('whatsapp_ingest',{p_key:hash,p_payload:body,p_mode:'live'}));
      }
      return respond({ error: "not_found" }, 404);
    } catch (e) {
      return respond({ error: e.message === "body_too_large" ? "body_too_large" : "processing_failed" }, e.message === "body_too_large" ? 413 : 503);
    }
  };
}
