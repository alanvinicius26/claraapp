// Shared public catalog. Stripe identifiers and all credentials stay on the server.
export const MAX_PROFESSIONALS = 5;
export const PLANS = Object.freeze([
  Object.freeze({
    id: "solo",
    limit: 1,
    amount: 2990,
    label: "1 atendente",
    secret: "STRIPE_PRICE_1_ID",
  }),
  Object.freeze({
    id: "team3",
    limit: 3,
    amount: 5990,
    label: "2 a 3 atendentes",
    secret: "STRIPE_PRICE_3_ID",
  }),
  Object.freeze({
    id: "team4",
    limit: 4,
    amount: 7990,
    label: "4 atendentes",
    secret: "STRIPE_PRICE_4_ID",
  }),
  Object.freeze({
    id: "team5",
    limit: 5,
    amount: 9990,
    label: "5 atendentes",
    secret: "STRIPE_PRICE_5_ID",
  }),
]);
export const planById = (id) => PLANS.find((plan) => plan.id === id);
export function planForCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PROFESSIONALS)
    return null;
  return PLANS.find((plan) => count <= plan.limit);
}
// The proprietor always occupies the first place, even with their agenda disabled.
export const teamSize = (professionals) =>
  1 + professionals.filter((p) => p.active && !p.is_default).length;
export const formatAmount = (amount) =>
  (amount / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
export function configuredPlans(env) {
  return PLANS.map((plan) => ({
    ...plan,
    priceId:
      env(plan.secret) || (plan.id === "solo" ? env("STRIPE_PRICE_ID") : ""),
  }));
}
