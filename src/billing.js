import { query, supabase, apiFetch } from "./lib";
export {
  PLANS,
  MAX_PROFESSIONALS,
  planById,
  planForCount,
  teamSize,
  formatAmount,
} from "../supabase/functions/_shared/plans.js";

export async function billingRequest(action, options = {}) {
  const data = await query(supabase.auth.getSession());
  if (!data.session) throw new Error("Entre novamente na sua conta.");
  const response = await apiFetch(
    import.meta.env.VITE_SUPABASE_URL + "/functions/v1/billing",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({ action, ...options }),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message || "Não foi possível abrir a assinatura.");
  return value;
}

export function paymentUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "checkout.stripe.com",
      "billing.stripe.com",
      "invoice.stripe.com",
    ].includes(url.hostname)
  )
    throw new Error("Endereço de pagamento inválido.");
  return url.href;
}
