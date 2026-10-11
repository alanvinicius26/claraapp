// Stripe API version is pinned by the billing transport. Never trust client totals or actor IDs.
export class AdminInputError extends Error {}
export class AdminAccessError extends Error {}

export async function adminAccess(input, actor, { db, stripe }) {
  const a = input.args || {};
  if (typeof a.p_owner !== "string" || !/^[0-9a-f-]{36}$/i.test(a.p_owner))
    throw new AdminInputError("Conta inválida.");
  const account = await db("admin_access_claim", {
    p_actor: actor,
    p_owner: a.p_owner,
  });
  try {
    if (account.customer_id) {
      const customer = encodeURIComponent(account.customer_id);
      const subscriptions = await stripe(
        `subscriptions?customer=${customer}&status=all&limit=100`,
      );
      const sessions = await stripe(
        `checkout/sessions?customer=${customer}&status=open&limit=100`,
      );
      if (subscriptions.has_more || sessions.has_more)
        throw new Error("Incomplete payment history");
      if (
        subscriptions.data.some(
          (s) => !["canceled", "incomplete_expired"].includes(s.status),
        ) ||
        sessions.data.length
      )
        throw new AdminInputError(
          "Há assinatura ou contratação em andamento na Stripe. Encerre-a antes de conceder gratuidade.",
        );
    }
    await db("admin_access_apply", {
      p_actor: actor,
      p_ticket: account.admin_ticket,
      p_owner: a.p_owner,
      p_kind: a.p_kind,
      p_plan: a.p_plan,
      p_expires: a.p_expires,
      p_reason: a.p_reason,
      p_expected: a.p_expected,
    });
    return { message: "Acesso gratuito atualizado." };
  } finally {
    await db("admin_access_release", {
      p_actor: actor,
      p_owner: a.p_owner,
      p_ticket: account.admin_ticket,
    });
  }
}

export function couponDefinition(input, now = Date.now()) {
  const code =
    typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const d = input.definition || {};
  if (!/^[A-Z0-9]{3,32}$/.test(code))
    throw new AdminInputError("Use de 3 a 32 letras ou números no código.");
  if (
    !["percent", "amount"].includes(d.type) ||
    !Number.isInteger(d.value) ||
    d.value < 1 ||
    d.value > (d.type === "percent" ? 100 : 9990)
  )
    throw new AdminInputError(
      "Informe um desconto de 1 a 100% ou de R$ 0,01 a R$ 99,90.",
    );
  if (
    !["once", "repeating", "forever"].includes(d.duration) ||
    (d.duration === "repeating" &&
      (!Number.isInteger(d.months) || d.months < 1 || d.months > 36))
  )
    throw new AdminInputError(
      "Escolha a duração do desconto (de 1 a 36 meses quando limitado).",
    );
  if (
    d.max_redemptions !== null &&
    (!Number.isInteger(d.max_redemptions) ||
      d.max_redemptions < 1 ||
      d.max_redemptions > 1000000)
  )
    throw new AdminInputError(
      "O limite de usos deve ser um número inteiro positivo.",
    );
  if (
    d.expires_at !== null &&
    (!Number.isInteger(d.expires_at) || d.expires_at * 1000 <= now)
  )
    throw new AdminInputError("A validade para resgate deve estar no futuro.");
  return {
    code,
    definition: {
      type: d.type,
      value: d.value,
      duration: d.duration,
      months: d.duration === "repeating" ? d.months : null,
      max_redemptions: d.max_redemptions,
      expires_at: d.expires_at,
    },
  };
}

function verifyPromotion(promo, record, live) {
  const couponId =
    typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;
  if (
    !/^promo_[A-Za-z0-9]+$/.test(promo.id) ||
    promo.livemode !== live ||
    promo.metadata?.clara_admin_coupon !== record.id ||
    promo.code?.toUpperCase() !== record.code ||
    couponId !== `clara_${record.id}`
  )
    throw new Error("Unexpected promotion code");
  return promo;
}

export async function adminCoupon(
  input,
  actor,
  { db, stripe, plans, live, validatePrice },
) {
  await db("admin_coupon_authorize", { p_actor: actor });
  const mode = live ? "live" : "test";
  let record;
  if (input.action === "admin_coupon_create") {
    const validated = couponDefinition(input);
    const products = [];
    for (const plan of plans) {
      const price = await stripe("prices/" + encodeURIComponent(plan.priceId));
      validatePrice(price, plan);
      if (price.livemode !== live || typeof price.product !== "string")
        throw new Error("Invalid coupon product");
      products.push(price.product);
    }
    record = await db("admin_coupon_prepare", {
      p_actor: actor,
      p_mode: mode,
      p_code: validated.code,
      p_definition: {
        ...validated.definition,
        products: [...new Set(products)].sort(),
      },
    });
  } else {
    if (typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id))
      throw new AdminInputError("Cupom inválido.");
    record = await db("admin_coupon_get", {
      p_actor: actor,
      p_id: input.id,
      p_mode: mode,
    });
  }
  let promo;
  if (record.promotion_id) {
    promo = verifyPromotion(
      await stripe(
        "promotion_codes/" + encodeURIComponent(record.promotion_id),
      ),
      record,
      live,
    );
  } else {
    // Recovery also works after Stripe's 24-hour idempotency window.
    const found = await stripe(
      "promotion_codes?code=" + encodeURIComponent(record.code) + "&limit=100",
    );
    if (found.has_more) throw new Error("Incomplete promotion list");
    const matching = found.data.filter(
      (p) => p.metadata?.clara_admin_coupon === record.id,
    );
    if (matching.length > 1) throw new Error("Duplicate promotion");
    promo = matching[0];
    if (promo) verifyPromotion(promo, record, live);
    if (!promo) {
      if (
        input.action === "admin_coupon_inspect" ||
        input.action === "admin_coupon_disable"
      )
        throw new AdminInputError(
          "Retome a criação deste cupom antes de consultar ou desativar.",
        );
      const d = record.definition;
      if (d.expires_at && d.expires_at * 1000 <= Date.now())
        throw new AdminInputError(
          "O prazo deste cupom expirou. Crie outro código com validade futura.",
        );
      const couponId = `clara_${record.id}`;
      let coupon = await stripe(
        "coupons/" + couponId,
        undefined,
        undefined,
        true,
      );
      if (!coupon) {
        const body = new URLSearchParams({
          id: couponId,
          name: record.code,
          duration: d.duration,
          "metadata[clara_admin_coupon]": record.id,
        });
        if (d.type === "percent") body.set("percent_off", String(d.value));
        else {
          body.set("amount_off", String(d.value));
          body.set("currency", "brl");
        }
        if (d.duration === "repeating")
          body.set("duration_in_months", String(d.months));
        if (d.max_redemptions)
          body.set("max_redemptions", String(d.max_redemptions));
        if (d.expires_at) body.set("redeem_by", String(d.expires_at));
        d.products.forEach((id, i) =>
          body.set(`applies_to[products][${i}]`, id),
        );
        coupon = await stripe(
          "coupons",
          body,
          "clara-admin-coupon-" + record.id,
        );
      }
      if (
        coupon.id !== couponId ||
        coupon.livemode !== live ||
        coupon.metadata?.clara_admin_coupon !== record.id
      )
        throw new Error("Unexpected coupon");
      const body = new URLSearchParams({
        coupon: couponId,
        code: record.code,
        "metadata[clara_admin_coupon]": record.id,
      });
      if (d.max_redemptions)
        body.set("max_redemptions", String(d.max_redemptions));
      if (d.expires_at) body.set("expires_at", String(d.expires_at));
      promo = verifyPromotion(
        await stripe(
          "promotion_codes",
          body,
          "clara-admin-promotion-" + record.id,
        ),
        record,
        live,
      );
    }
  }
  if (input.action === "admin_coupon_disable" && promo.active) {
    promo = verifyPromotion(
      await stripe(
        "promotion_codes/" + encodeURIComponent(promo.id),
        new URLSearchParams({ active: "false" }),
        "clara-admin-disable-" + record.id,
      ),
      record,
      live,
    );
  }
  record = await db("admin_coupon_finish", {
    p_actor: actor,
    p_id: record.id,
    p_mode: mode,
    p_coupon: `clara_${record.id}`,
    p_promotion: promo.id,
    p_state: promo.active ? "active" : "inactive",
  });
  return {
    coupon: {
      ...record,
      times_redeemed: promo.times_redeemed,
      stripe_active: promo.active,
    },
    message:
      input.action === "admin_coupon_disable"
        ? "Cupom desativado para novos resgates. Descontos já concedidos continuam válidos."
        : "Cupom sincronizado.",
  };
}
