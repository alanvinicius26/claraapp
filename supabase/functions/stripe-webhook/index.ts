import {
  verifyStripeSignature,
  subscriptionState,
  canonicalSubscription,
} from "../billing/core.js";
import { configuredPlans } from "../_shared/plans.js";
const env = (key: string) => Deno.env.get(key)?.trim() || "";
const reply = (status = 200) =>
  new Response(JSON.stringify({ received: status === 200 }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 262144)
      return reply(413);
    const raw = await req.text();
    if (raw.length > 262144) return reply(413);
    if (
      !(await verifyStripeSignature(
        raw,
        req.headers.get("stripe-signature"),
        env("STRIPE_WEBHOOK_SECRET"),
      ))
    )
      return reply(400);
    const event = JSON.parse(raw);
    const live = env("BILLING_MODE") === "live";
    if (event.livemode !== live) return reply(400);
    if (
      ![
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.pending_update_applied",
        "customer.subscription.pending_update_expired",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.voided",
      ].includes(event.type)
    )
      return reply();
    const object = event.data.object;
    const subscriptionId = event.type.startsWith("customer.subscription.")
      ? object.id
      : object.parent?.subscription_details?.subscription ||
        object.subscription;
    if (!subscriptionId) return reply();
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return reply(400);
    const customer =
      typeof object.customer === "string"
        ? object.customer
        : object.customer?.id;
    if (!/^cus_[A-Za-z0-9]+$/.test(customer || "")) return reply(400);
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    const dbHeaders = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const claim = await fetch(
      env("SUPABASE_URL") + "/rest/v1/rpc/billing_sync_claim",
      {
        method: "POST",
        headers: dbHeaders,
        body: JSON.stringify({ p_customer: customer, p_event: event.id }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!claim.ok) return reply(503);
    const ticket = await claim.json();
    if (!ticket) return reply();
    // Serialize retrieval + commit per customer. Fetch the current subscription,
    // even when the triggering event refers to an older canceled subscription.
    const response = await fetch(
      "https://api.stripe.com/v1/subscriptions?customer=" +
        customer +
        "&status=all&limit=100&expand[]=data.latest_invoice",
      {
        headers: {
          Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
          "Stripe-Version": "2025-04-30.basil",
        },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) return reply(503);
    const list = await response.json();
    const plans = configuredPlans(env);
    const subscription = canonicalSubscription(list, plans);
    if (!subscription) return reply(503);
    const state = subscriptionState(subscription, plans);
    const saved = await fetch(
      env("SUPABASE_URL") + "/rest/v1/rpc/billing_apply_plan_event",
      {
        method: "POST",
        headers: dbHeaders,
        body: JSON.stringify({
          p_event: event.id,
          p_created: event.created,
          p_customer: customer,
          p_subscription: subscription.id,
          p_status: state.status,
          p_until: state.until,
          p_cancel: state.cancel,
          p_ticket: ticket,
          p_plan: state.plan,
          p_preserve_paid: state.preservePaid,
          p_period_end: state.periodEnd,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!saved.ok) return reply(503);
    return reply();
  } catch {
    console.warn("billing_webhook_failed");
    return reply(503);
  }
});
