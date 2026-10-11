import { validatePrice, subscriptionState } from "./core.js";
import { configuredPlans } from "../_shared/plans.js";
import {
  adminCoupon,
  adminAccess,
  AdminInputError,
  AdminAccessError,
} from "./admin.js";
const env = (key: string) => Deno.env.get(key)?.trim() || "";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
class BusinessError extends Error {}
const live = env("BILLING_MODE") === "live",
  plans = configuredPlans(env),
  stripeKey = env("STRIPE_SECRET_KEY");
const configured =
  new RegExp(live ? "^sk_live_" : "^sk_test_").test(stripeKey) &&
  plans.every((p) => /^price_[A-Za-z0-9_]+$/.test(p.priceId)) &&
  new Set(plans.map((p) => p.priceId)).size === 4 &&
  /^bpc_[A-Za-z0-9]+$/.test(env("STRIPE_PORTAL_CONFIGURATION_ID")) &&
  /^https:\/\//.test(env("APP_ORIGIN"));
async function stripe(
  path: string,
  body?: URLSearchParams,
  idempotency?: string,
  allowMissing = false,
) {
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Stripe-Version": "2025-04-30.basil",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
    },
    body,
    signal: AbortSignal.timeout(12000),
  });
  const value = await response.json();
  if (
    allowMissing &&
    response.status === 404 &&
    value.error?.code === "resource_missing"
  )
    return null;
  if (!response.ok) throw new Error("payment_provider");
  return value;
}
async function db(name: string, args: Record<string, unknown>) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(env("SUPABASE_URL") + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) {
    if (value.code === "42501")
      throw new AdminAccessError("Acesso restrito à administração.");
    if (value.code === "P0001") throw new BusinessError(value.message);
    throw new Error("billing_database");
  }
  return value;
}
async function subscriptions(customer: string) {
  const list = await stripe(
    `subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100&expand[]=data.latest_invoice`,
  );
  if (list.has_more) throw new Error("incomplete_subscription_list");
  const open = list.data.filter(
    (s: any) => !["canceled", "incomplete_expired"].includes(s.status),
  );
  if (open.length > 1)
    throw new BusinessError(
      "Há mais de uma assinatura em andamento. Entre em contato com o suporte.",
    );
  return open[0];
}
async function checkoutForOperation(
  account: any,
  cancel: boolean,
  returnUrl: string,
) {
  const op = account.operation;
  const list = await stripe(
    `checkout/sessions?customer=${encodeURIComponent(account.customer_id)}&limit=100`,
  );
  if (list.has_more) throw new Error("incomplete_checkout_list");
  const session = list.data.find(
    (s: any) => s.metadata?.clara_operation === op.key,
  );
  if (session?.status === "complete")
    return {
      clear: true,
      message: "Pagamento enviado. Aguarde a confirmação da assinatura.",
    };
  if (cancel) {
    if (session?.status === "open")
      await stripe(
        `checkout/sessions/${encodeURIComponent(session.id)}/expire`,
        new URLSearchParams(),
        "clara-expire-" + op.key,
      );
    return {
      clear: true,
      message:
        "Contratação pendente cancelada. Você pode escolher outro plano.",
    };
  }
  if (
    session?.status === "expired" ||
    op.expires <= Math.floor(Date.now() / 1000)
  )
    return {
      clear: true,
      message: "Esta contratação expirou. Confira o plano e tente novamente.",
    };
  if (session?.status === "open") return { clear: false, url: session.url };
  if (await subscriptions(account.customer_id))
    return {
      clear: true,
      message:
        "Você já possui uma assinatura em andamento. Atualize a tela para acompanhar a confirmação.",
    };
  const plan = plans.find((p) => p.id === op.plan)!;
  const checkout = await stripe(
    "checkout/sessions",
    new URLSearchParams({
      mode: "subscription",
      allow_promotion_codes: "true",
      customer: account.customer_id,
      "line_items[0][price]": plan.priceId,
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      success_url: returnUrl,
      cancel_url: returnUrl,
      expires_at: String(op.expires),
      client_reference_id: account.owner_id,
      "metadata[clara_operation]": op.key,
      "subscription_data[metadata][owner_id]": account.owner_id,
      "subscription_data[metadata][clara_plan]": plan.id,
    }),
    "clara-checkout-" + op.key,
  );
  return { clear: false, url: checkout.url };
}
async function changePlan(account: any, cancel: boolean) {
  const op = account.operation;
  const subscription = await subscriptions(account.customer_id);
  if (!subscription || subscription.id !== op.subscription)
    return {
      clear: true,
      message: "Sua assinatura mudou. Atualize a tela antes de continuar.",
    };
  const state = subscriptionState(subscription, plans);
  if (state.plan === op.plan && !subscription.pending_update)
    return {
      clear: account.plan_id === op.plan,
      message: "Plano atualizado. Aguarde a confirmação na Clara.",
    };
  if (state.plan !== op.from_plan)
    throw new BusinessError(
      "Seu plano foi alterado. Atualize a tela antes de continuar.",
    );
  if (cancel) {
    if (subscription.pending_update) {
      const invoice = subscription.latest_invoice;
      if (
        !invoice?.id ||
        invoice.status !== "open" ||
        invoice.billing_reason !== "subscription_update"
      )
        throw new BusinessError(
          "Aguarde a confirmação do pagamento antes de cancelar esta alteração.",
        );
      await stripe(
        `invoices/${encodeURIComponent(invoice.id)}/void`,
        new URLSearchParams(),
        "clara-void-" + op.key,
      );
    }
    return {
      clear: true,
      message: "Alteração pendente cancelada. Seu plano anterior foi mantido.",
    };
  }
  if (subscription.pending_update)
    return {
      clear: false,
      url: subscription.latest_invoice?.hosted_invoice_url,
      message: "Conclua o pagamento da diferença para liberar o novo plano.",
    };
  const now = Math.floor(Date.now() / 1000);
  if (
    now - op.created >= 23 * 3600 ||
    (subscription.latest_invoice?.status === "void" &&
      subscription.latest_invoice?.billing_reason === "subscription_update" &&
      subscription.latest_invoice.created >= op.created)
  )
    return {
      clear: true,
      message:
        "Esta alteração expirou. Seu plano anterior foi mantido. Confira os valores e tente novamente.",
    };
  if (
    state.status !== "active" ||
    state.cancel ||
    (!state.until && !state.preservePaid) ||
    !account.paid_until ||
    Date.parse(account.paid_until) <= Date.now()
  )
    throw new BusinessError(
      "Regularize sua assinatura antes de alterar o plano.",
    );
  const plan = plans.find((p) => p.id === op.plan)!,
    previous = plans.find((p) => p.id === op.from_plan)!;
  const params = new URLSearchParams({
    "items[0][id]": subscription.items.data[0].id,
    "items[0][price]": plan.priceId,
    "items[0][quantity]": "1",
    payment_behavior: "pending_if_incomplete",
    proration_behavior: plan.limit > previous.limit ? "always_invoice" : "none",
    "expand[0]": "latest_invoice",
  });
  if (plan.limit > previous.limit)
    params.set("proration_date", String(op.created));
  const updated = await stripe(
    `subscriptions/${encodeURIComponent(subscription.id)}`,
    params,
    "clara-change-" + op.key,
  );
  if (updated.pending_update)
    return {
      clear: false,
      url: updated.latest_invoice?.hosted_invoice_url,
      message: "Conclua o pagamento da diferença para liberar o novo plano.",
    };
  if (subscriptionState(updated, plans).plan !== plan.id)
    throw new Error("unconfirmed_plan_change");
  return {
    clear: false,
    message: "Plano atualizado. Aguarde a confirmação na Clara.",
  };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST")
    return reply({ message: "Método não permitido." }, 405);
  let operationAccount: any;
  let clear = false;
  try {
    const authorization = req.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer "))
      return reply({ message: "Entre na sua conta." }, 401);
    const identity = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
      headers: {
        Authorization: authorization,
        apikey: env("APP_PUBLISHABLE_KEY"),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!identity.ok)
      return reply({ message: "Entre novamente na sua conta." }, 401);
    const user = await identity.json(),
      raw = await req.text();
    if (raw.length > 4096)
      return reply({ message: "Solicitação inválida." }, 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return reply({ message: "Solicitação inválida." }, 400);
    }
    const action = input?.action;
    if (
      ![
        "status",
        "portal",
        "checkout",
        "change",
        "cancel_pending",
        "admin_access_set",
        "admin_coupon_create",
        "admin_coupon_resume",
        "admin_coupon_inspect",
        "admin_coupon_disable",
      ].includes(action)
    )
      return reply({ message: "Solicitação inválida." }, 400);
    if (action === "status")
      return reply({
        configured,
        mode: live ? "live" : "test",
        plans_version: 2,
      });
    if (!configured)
      return reply(
        {
          message:
            "A assinatura ainda está sendo habilitada. Tente novamente mais tarde.",
        },
        503,
      );
    if (action !== "portal" && input.confirmed !== true)
      return reply({ message: "Confirme o plano antes de continuar." }, 400);
    if (
      !(await db("booking_rate_limit", {
        p_bucket: `billing:${user.id}`,
        p_limit: 10,
        p_seconds: 60,
      }))
    )
      return reply(
        { message: "Aguarde um minuto antes de tentar novamente." },
        429,
      );
    if (action === "admin_access_set")
      return reply(await adminAccess(input, user.id, { db, stripe }));
    if (action.startsWith("admin_coupon_")) {
      return reply(
        await adminCoupon(input, user.id, {
          db,
          stripe,
          plans,
          live,
          validatePrice,
        }),
      );
    }
    let account = await db("billing_backend_account", { p_owner: user.id });
    if (account.plans_version !== 2)
      throw new BusinessError("Os novos planos ainda estão sendo habilitados.");
    if (!account.billing_enabled)
      throw new BusinessError(
        "A cobrança ainda não foi ativada. Seu acesso continua disponível.",
      );
    const returnUrl = new URL(env("APP_ORIGIN")).origin + "/#/app/assinatura";
    if (action === "portal") {
      if (!account.customer_id)
        throw new BusinessError("Você ainda não possui uma assinatura paga.");
      const config = await stripe(
        "billing_portal/configurations/" +
          encodeURIComponent(env("STRIPE_PORTAL_CONFIGURATION_ID")),
      );
      if (
        !config.active ||
        config.features?.subscription_update?.enabled !== false ||
        (config.features?.subscription_cancel?.enabled &&
          config.features.subscription_cancel.mode !== "at_period_end")
      )
        throw new Error("unsafe_portal_configuration");
      const portal = await stripe(
        "billing_portal/sessions",
        new URLSearchParams({
          customer: account.customer_id,
          return_url: returnUrl,
          configuration: config.id,
        }),
      );
      return reply({ url: portal.url });
    }
    if (account.benefit && action !== "cancel_pending")
      throw new BusinessError(
        "Seu acesso gratuito está ativo. Nenhuma assinatura é necessária durante este período.",
      );
    const selected =
      action === "cancel_pending" ? account.operation?.plan : input.plan;
    const kind =
      action === "cancel_pending" ? account.operation?.action : action;
    if (action === "cancel_pending" && !account.operation)
      return reply({ message: "Não há alteração pendente." });
    const plan = plans.find((p) => p.id === selected);
    if (!plan)
      return reply({ message: "Escolha um dos planos disponíveis." }, 400);
    if (Date.parse(account.trial_ends_at) > Date.now())
      throw new BusinessError(
        "Seu teste grátis continua ativo. Você poderá assinar ao terminar os sete dias.",
      );
    if (action !== "cancel_pending") {
      const price = await stripe("prices/" + encodeURIComponent(plan.priceId));
      validatePrice(price, plan);
      if (price.livemode !== live) throw new Error("price_mode_mismatch");
    }
    if (!account.customer_id) {
      const customer = await stripe(
        "customers",
        new URLSearchParams({ "metadata[owner_id]": user.id }),
        "clara-customer-" + user.id,
      );
      account = await db("billing_backend_account", {
        p_owner: user.id,
        p_customer: customer.id,
      });
    }
    operationAccount = await db("billing_begin_operation", {
      p_owner: user.id,
      p_action: kind,
      p_plan: plan.id,
    });
    const result =
      kind === "checkout"
        ? await checkoutForOperation(
            operationAccount,
            action === "cancel_pending",
            returnUrl,
          )
        : await changePlan(operationAccount, action === "cancel_pending");
    clear = result.clear;
    return reply({ url: result.url, message: result.message });
  } catch (e) {
    if (e instanceof AdminAccessError)
      return reply({ message: e.message }, 403);
    if (e instanceof AdminInputError) return reply({ message: e.message }, 400);
    if (e instanceof BusinessError) return reply({ message: e.message }, 409);
    console.warn("billing_request_failed");
    return reply(
      {
        message:
          "Não foi possível concluir agora. Tente novamente: uma solicitação em andamento será retomada sem duplicar a cobrança.",
      },
      503,
    );
  } finally {
    if (operationAccount) {
      try {
        await db("billing_finish_operation", {
          p_owner: operationAccount.owner_id,
          p_key: operationAccount.operation.key,
          p_ticket: operationAccount.operation_ticket,
          p_clear: clear,
        });
      } catch {
        console.warn("billing_operation_release_failed");
      }
    }
  }
});
