import { validStart, bookingError } from "./validation.js";
// Public booking gateway. API key identifies this app; management uses a secret
// reservation token. No service key is ever returned to the browser.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const publicKey = Deno.env.get("APP_PUBLISHABLE_KEY")?.trim();
if (!publicKey || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
  throw new Error("Configure APP_PUBLISHABLE_KEY com a chave publicável deste projeto antes de publicar booking.");
}
const names = [
  "booking_page",
  "available_slots",
  "available_slots_multi",
  "available_dates_multi",
  "available_slots_team",
  "available_dates_team",
  "book_appointment_team",
  "book_appointment",
  "book_appointment_multi",
  "manage_booking",
];
const parameters: Record<string, string[]> = {
  available_slots_team: ["p_slug", "p_services", "p_date", "p_token", "p_professional"],
  available_dates_team: ["p_slug", "p_services", "p_after", "p_until", "p_token", "p_professional"],
  book_appointment_team: ["p_slug", "p_services", "p_start", "p_name", "p_email", "p_phone", "p_notes", "p_professional"],
  booking_page: ["p_slug"],
  available_slots: ["p_slug", "p_service", "p_date"],
  book_appointment: [
    "p_slug",
    "p_service",
    "p_start",
    "p_name",
    "p_email",
    "p_phone",
    "p_notes",
  ],
  available_slots_multi: ["p_slug", "p_services", "p_date", "p_token"],
  available_dates_multi: ["p_slug", "p_services", "p_after", "p_until", "p_token"],
  book_appointment_multi: [
    "p_slug",
    "p_services",
    "p_start",
    "p_name",
    "p_email",
    "p_phone",
    "p_notes",
  ],
  manage_booking: ["p_token", "p_action", "p_start"],
};
const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });
async function db(name: string, args: Record<string, unknown>) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const result = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(12000),
    },
  );
  return { ok: result.ok, data: await result.json() };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST")
    return respond({ message: "Método não permitido." }, 405);
  // Custom API-key validation; JWT verification is disabled because visitors do not log in.
  const apiKey = req.headers.get("apikey");
  if (apiKey !== publicKey && apiKey !== Deno.env.get("SUPABASE_ANON_KEY"))
    return respond({ message: "Aplicativo não autorizado." }, 401);
  try {
    const raw = await req.text();
    if (raw.length > 12000)
      return respond({ message: "Dados muito longos." }, 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return respond({ message: "Solicitação inválida." }, 400); }
    const { action, args } = payload || {};
    if (
      !names.includes(action) ||
      !args ||
      typeof args !== "object" ||
      Array.isArray(args)
    )
      return respond({ message: "Solicitação inválida." }, 400);
    if (
      Object.keys(args).some((key) => !parameters[action].includes(key)) ||
      Object.entries(args).some(([key, v]) =>
        key === "p_services"
          ? !Array.isArray(v) ||
            v.length < 1 ||
            v.length > 20 ||
            new Set(v).size !== v.length ||
            v.some(
              (id) =>
                typeof id !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  id,
                ),
            )
          : v !== null && typeof v !== "string",
      )
    )
      return respond({ message: "Dados inválidos." }, 400);
    if (args.p_slug && !/^[a-z0-9][a-z0-9-]{2,59}$/.test(args.p_slug))
      return respond({ message: "Endereço inválido." }, 400);
    if ((action.startsWith("book_appointment") || (action === "manage_booking" && args.p_action === "reschedule")) && !validStart(args.p_start))
      return respond({ message: "Informe um horário válido com fuso horário." }, 400);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ip),
    );
    const fingerprint = Array.from(new Uint8Array(digest))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    const write =
      action === "book_appointment" ||
      action === "book_appointment_multi" ||
      action === "book_appointment_team" ||
      (action === "manage_booking" && args.p_action && args.p_action !== "get");
    const limited = await db("booking_rate_limit", {
      p_bucket: `${write ? "write" : "read"}:${fingerprint}`,
      p_limit: write ? 15 : 120,
      p_seconds: write ? 600 : 60,
    });
    if (!limited.ok)
      return respond({ message: "Serviço temporariamente indisponível." }, 503);
    if (!limited.data)
      return respond(
        { message: "Muitas tentativas. Aguarde alguns minutos." },
        429,
      );
    const result = await db(action, args);
    if (!result.ok) {
      const { status, ...error } = bookingError(result.data);
      return respond(error, status);
    }
    return respond({ data: result.data });
  } catch {
    return respond(
      { message: "Não foi possível processar a solicitação." },
      503,
    );
  }
});
