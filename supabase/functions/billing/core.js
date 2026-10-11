import { PLANS } from "../_shared/plans.js";
export const MONTHLY_AMOUNT = PLANS[0].amount;
export function validatePrice(
  price,
  plan = PLANS[0],
  { requireActive = true } = {},
) {
  if (
    !price ||
    (requireActive && !price.active) ||
    price.currency !== "brl" ||
    price.unit_amount !== plan.amount ||
    (plan.priceId && price.id !== plan.priceId) ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1 ||
    (price.recurring?.usage_type &&
      price.recurring.usage_type !== "licensed") ||
    price.transform_quantity ||
    price.custom_unit_amount ||
    (price.billing_scheme && price.billing_scheme !== "per_unit")
  )
    throw new Error("Plano de cobrança inválido.");
}
export async function verifyStripeSignature(
  raw,
  header,
  secret,
  now = Date.now(),
) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((x) => x.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  if (
    !/^\d+$/.test(timestamp || "") ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${raw}`),
    ),
  );
  return parts
    .filter(([key]) => key === "v1")
    .some(([, value]) => {
      if (!/^[a-f0-9]{64}$/i.test(value)) return false;
      let diff = 0;
      for (let i = 0; i < signature.length; i++)
        diff |= signature[i] ^ parseInt(value.slice(i * 2, i * 2 + 2), 16);
      return diff === 0;
    });
}
export function subscriptionState(subscription, catalog) {
  const plans =
    typeof catalog === "string" ? [{ ...PLANS[0], priceId: catalog }] : catalog;
  const items = subscription.items?.data || [];
  const plan = plans.find(
    (p) => p.priceId && p.priceId === items[0]?.price?.id,
  );
  if (
    items.length !== 1 ||
    subscription.items?.has_more ||
    !plan ||
    items[0].quantity !== 1
  )
    throw new Error("Assinatura fora do plano permitido.");
  validatePrice(items[0].price, plan, { requireActive: false });
  const end = items[0].current_period_end;
  const paid =
    subscription.latest_invoice?.paid === true ||
    subscription.latest_invoice?.status === "paid";
  return {
    plan: plan.id,
    limit: plan.limit,
    status: subscription.status,
    until:
      paid && Number.isFinite(end) ? new Date(end * 1000).toISOString() : null,
    cancel: subscription.cancel_at_period_end === true,
    // An unsuccessful upgrade must not revoke the already-paid original plan.
    // The DB can preserve, but never extend, its previous paid_until in this case.
    preservePaid:
      !paid &&
      subscription.status === "active" &&
      (subscription.pending_update != null ||
        subscription.latest_invoice?.billing_reason === "subscription_update"),
    periodEnd: Number.isFinite(end) ? new Date(end * 1000).toISOString() : null,
  };
}

export function canonicalSubscription(list, plans) {
  if (list.has_more) throw new Error("Lista de assinaturas incompleta.");
  const subscriptions = list.data.filter((s) =>
    s.items?.data?.some((i) =>
      plans.some((p) => p.priceId && p.priceId === i.price?.id),
    ),
  );
  const open = subscriptions.filter(
    (s) => !["canceled", "incomplete_expired"].includes(s.status),
  );
  if (open.length > 1) throw new Error("Mais de uma assinatura em andamento.");
  return open[0] || subscriptions.sort((a, b) => b.created - a.created)[0];
}
