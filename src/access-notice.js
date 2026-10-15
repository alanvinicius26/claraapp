// What to tell the owner when the database stops allowing writes and new online
// bookings (encaixa_private.billing_access). `status` is the billing_status RPC result.
export function accessNotice(status) {
  if (!status || status.can_use !== false || status.billing_enabled === false) return null;
  const overTeam = Number(status.active_professionals) > Number(status.effective_limit);
  const paid = status.status === "active" && Date.parse(status.paid_until) > Date.now();
  if (overTeam && (paid || status.benefit))
    return {
      kind: "team_limit",
      title: "Sua equipe passou do limite do plano",
      body: "Para voltar a agendar e receber reservas online, escolha um plano para o tamanho atual da equipe ou desative profissionais em Equipe.",
      cta: "Ver planos",
    };
  if (status.has_subscription && ["past_due", "unpaid", "incomplete"].includes(status.status))
    return {
      kind: "payment_failed",
      title: "Não conseguimos confirmar seu pagamento",
      body: "Atualize a forma de pagamento para voltar a agendar e receber reservas online. Sua agenda e seus dados continuam guardados.",
      cta: "Regularizar pagamento",
    };
  if (status.has_subscription)
    return {
      kind: "subscription_ended",
      title: "Sua assinatura terminou",
      body: "Assine novamente para voltar a agendar e receber reservas online. Sua agenda e seus dados continuam guardados.",
      cta: "Assinar novamente",
    };
  return {
    kind: "trial_ended",
    title: "Seu teste grátis de 7 dias terminou",
    body: "Escolha um plano para continuar agendando e recebendo reservas pelo seu link. Sua agenda, clientes e recebimentos continuam guardados e você ainda pode consultá-los.",
    cta: "Escolher plano e assinar",
  };
}

// Next instant the answer may change by itself (trial, paid period or admin
// access ending), so an open panel shows the notice at the right moment.
export function nextAccessCheck(status, now = Date.now()) {
  if (!status?.can_use) return null;
  const times = [status.trial_ends_at, status.paid_until, status.benefit?.expires_at]
    .map((v) => Date.parse(v))
    .filter((t) => Number.isFinite(t) && t > now);
  return times.length ? Math.min(...times) : null;
}

// The full-screen notice appears once per kind per browser session; the banner stays.
export const noticeSeenKey = (owner, kind) => `clara-access-notice:${owner}:${kind}`;
