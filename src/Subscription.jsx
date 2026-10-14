import React, { useEffect, useRef, useState } from "react";
import { rpc, errorMessage } from "./lib";
import { BrandMark } from "./Brand";
import { Check, ShieldCheck, CalendarCheck, Sparkles, Repeat2 } from "lucide-react";
import {
  billingRequest,
  paymentUrl,
  PLANS,
  planById,
  planForCount,
  teamSize,
  formatAmount,
} from "./billing";
import "./billing-plans.css";

const EMPTY_PROFESSIONALS = Object.freeze([]);

export default function Subscription({
  demo,
  notify,
  professionals = EMPTY_PROFESSIONALS,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(""),
    [confirming, setConfirming] = useState(false);
  const requestBusy = useRef(false),
    confirmationTitle = useRef(null);
  useEffect(() => {
    if (confirming) confirmationTitle.current?.focus();
  }, [confirming]);
  useEffect(() => {
    let current = true,
      inFlight = false;
    setError(false);
    if (demo) {
      setData({
        can_use: true,
        status: "demo",
        active_professionals: teamSize(professionals),
        configured: false,
      });
      return;
    }
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [state, config] = await Promise.all([
          rpc("billing_status"),
          billingRequest("status"),
        ]);
        if (current) {
          setData({
            ...state,
            configured:
              config.configured &&
              state.plans_version === 2 &&
              config.plans_version === 2,
            mode: config.mode,
          });
          setError(false);
        }
      } catch {
        if (current) setError(true);
      } finally {
        inFlight = false;
      }
    };
    load();
    const refresh = () => {
      if (!document.hidden && navigator.onLine) load();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [demo, attempt, professionals]);
  const count = data?.active_professionals ?? teamSize(professionals);
  const required = planForCount(count);
  const currentPlan = planById(data?.plan_id);
  const benefit = data?.benefit;
  const benefitPlan = planById(benefit?.plan_id);
  const selectedPlan =
    planById(selected) ||
    benefitPlan ||
    (data?.has_subscription && currentPlan?.limit >= count
      ? currentPlan
      : required) ||
    PLANS[0];
  const trial =
    !benefit &&
    data?.trial_ends_at &&
    Date.parse(data.trial_ends_at) > Date.now();
  const pendingActivation = data?.billing_enabled === false;
  const renewable =
    data?.has_subscription &&
    !["canceled", "incomplete_expired"].includes(data.status);
  const until = benefit
    ? benefit.expires_at
    : trial
      ? data.trial_ends_at
      : data?.paid_until ||
        (!data?.has_subscription ? data?.trial_ends_at : null);
  const date = until
    ? new Date(until).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
  const canChange =
    renewable &&
    data.status === "active" &&
    data.can_use &&
    !data.cancel_at_period_end;
  const blocked =
    busy ||
    error ||
    !data?.configured ||
    pendingActivation ||
    benefit ||
    trial ||
    !required ||
    selectedPlan.limit < count;
  async function act(action, plan = selectedPlan.id) {
    if (requestBusy.current || demo) return;
    requestBusy.current = true;
    setBusy(true);
    try {
      const result = await billingRequest(action, { plan, confirmed: true });
      if (result.url) location.assign(paymentUrl(result.url));
      else
        notify(
          result.message || "Solicitação recebida. Aguarde a confirmação.",
        );
      setConfirming(false);
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      requestBusy.current = false;
      setBusy(false);
      setAttempt((n) => n + 1);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">MAIS TEMPO PARA O QUE VOCÊ AMA</span>
          <h1>Minha assinatura</h1>
          <p>
            {benefit
              ? "Seu plano está liberado gratuitamente. Confira os detalhes do seu acesso."
              : "Sete dias grátis. Depois, escolha o plano para sua equipe de até cinco atendentes."}
          </p>
        </div>
      </div>
      <div className="subscription-grid">
        <section className="plan-card">
          <div className="plan-top">
            <BrandMark size={44} />
            <span>CLARA</span>
          </div>
          <h2>Seu estúdio em um só lugar.</h2>
          {!benefit && (
            <fieldset
              className="billing-plan-options"
              disabled={busy || !!data?.pending_plan}
            >
              <legend>Mensalidade total da equipe</legend>
              {PLANS.map((plan) => (
                <label
                  key={plan.id}
                  className={`billing-plan-option ${selectedPlan.id === plan.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="clara-plan"
                    value={plan.id}
                    checked={selectedPlan.id === plan.id}
                    disabled={plan.limit < count}
                    onChange={() => {
                      setSelected(plan.id);
                      setConfirming(false);
                    }}
                  />
                  <span>
                    {plan.label}
                    <strong>
                      {formatAmount(plan.amount)}
                      <small> / mês</small>
                    </strong>
                    {plan.limit < count && (
                      <small>
                        Desative atendentes para escolher este plano.
                      </small>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p>
            {benefit ? (
              <>
                <strong>
                  {benefitPlan?.label} · R$ 0,00 durante o benefício.
                </strong>{" "}
                O proprietário está incluído.
              </>
            ) : (
              "O proprietário está incluído. O plano de R$ 59,90 permite até três atendentes, sem acréscimo ao adicionar o terceiro."
            )}
          </p>
          <div className="plan-features">
            {[
              "Agenda e reservas online",
              "Clientes e histórico de atendimentos",
              "Serviços e equipe",
              "Controle dos recebimentos",
              "Assistente Clara",
            ].map((text) => (
              <span key={text}>
                <Check size={15} aria-hidden="true" /> {text}
              </span>
            ))}
          </div>
          <p>
            {benefit
              ? "Aproveite os recursos da Clara com o acesso liberado para sua conta."
              : "Experimente por sete dias sem cartão, com até cinco atendentes. A mensalidade só começa quando você contratar."}
          </p>
        </section>
        <section className="panel payment-method" aria-live="polite">
          <h2>
            {demo
              ? "Conheça os planos"
              : pendingActivation
                ? "Seu acesso continua disponível"
                : benefit
                  ? "Seu acesso gratuito está ativo"
                  : trial
                    ? "Seu teste grátis está ativo"
                    : data?.can_use
                      ? "Sua assinatura está ativa"
                      : "Continue com a Clara"}
          </h2>
          {error ? (
            <>
              <p>
                Não foi possível consultar sua assinatura. Confira a conexão e
                tente novamente.
              </p>
              <button
                className="button secondary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Tentar novamente
              </button>
            </>
          ) : !data ? (
            <p>Consultando sua assinatura...</p>
          ) : demo ? (
            <>
              <p>
                Esta é uma demonstração. Crie seu espaço para conhecer a Clara.
              </p>
              <ul className="plan-promises">
                <li>
                  <CalendarCheck size={20} aria-hidden="true" />
                  <span>
                    <strong>Sete dias grátis, sem cartão</strong>
                    Use a agenda completa antes de decidir.
                  </span>
                </li>
                <li>
                  <Sparkles size={20} aria-hidden="true" />
                  <span>
                    <strong>Todos os recursos em todos os planos</strong>
                    O valor muda só pelo tamanho da equipe.
                  </span>
                </li>
                <li>
                  <Repeat2 size={20} aria-hidden="true" />
                  <span>
                    <strong>Mensal, sem fidelidade</strong>
                    Troque de plano ou cancele quando quiser.
                  </span>
                </li>
                <li>
                  <ShieldCheck size={20} aria-hidden="true" />
                  <span>
                    <strong>Pagamento protegido</strong>
                    Cobrança processada pela Stripe.
                  </span>
                </li>
              </ul>
              <a className="button primary" href="#/cadastro">
                Criar meu espaço
              </a>
            </>
          ) : (
            <>
              <p>
                <strong>
                  {count} de {data.effective_limit || 5} atendentes
                </strong>
                , incluindo o proprietário.
              </p>
              {benefit ? (
                <>
                  <p>
                    <strong>
                      {benefit.kind === "free_period"
                        ? "Período gratuito"
                        : "Conta cortesia"}
                    </strong>{" "}
                    · {benefitPlan?.label}.
                  </p>
                  <p>
                    {date
                      ? `Seu acesso gratuito está disponível até ${date}.`
                      : "Seu acesso gratuito não tem data de vencimento."}
                  </p>
                  <p>
                    Você não precisa contratar uma assinatura durante este
                    período. O encerramento do benefício não gera cobrança
                    automática.
                  </p>
                  {!data.can_use && (
                    <p className="notice">
                      Sua equipe excede o plano liberado. Desative os atendentes
                      excedentes para continuar.
                    </p>
                  )}
                </>
              ) : pendingActivation ? (
                <>
                  <p>
                    A cobrança ainda não foi ativada. Você pode continuar usando
                    seu espaço normalmente.
                  </p>
                  <p>
                    Quando a assinatura for disponibilizada, você terá sete dias
                    grátis. Nenhuma cobrança será feita sem sua contratação.
                  </p>
                </>
              ) : (
                <>
                  {date && (
                    <p>
                      {trial
                        ? "Teste disponível até"
                        : data.can_use
                          ? "Acesso pago até"
                          : "Seu último período terminou em"}{" "}
                      {date}.
                    </p>
                  )}
                  {renewable && currentPlan && (
                    <p>
                      Plano contratado (valor sem descontos):{" "}
                      <strong>
                        até {currentPlan.limit}{" "}
                        {currentPlan.limit === 1 ? "atendente" : "atendentes"} ·{" "}
                        {formatAmount(currentPlan.amount)}/mês
                      </strong>
                      .
                    </p>
                  )}
                  {data.cancel_at_period_end && renewable && data.can_use && (
                    <p>
                      A renovação está cancelada. O período já pago continua
                      disponível até a data acima.
                    </p>
                  )}
                  {data.status === "canceled" && (
                    <p>Sua assinatura foi encerrada.</p>
                  )}
                  {trial && (
                    <p>
                      Ao terminar o teste, escolha um plano compatível com sua
                      equipe ou desative os atendentes excedentes. O histórico
                      será preservado.
                    </p>
                  )}
                  {!trial && !data.can_use && (
                    <p>
                      Seus dados continuam disponíveis para consulta. Regularize
                      sua assinatura para voltar a cadastrar, editar e receber
                      novas reservas.
                    </p>
                  )}
                  {data.mode === "test" && (
                    <p className="notice">
                      Ambiente de teste: nenhuma cobrança real.
                    </p>
                  )}
                  {!data.configured ? (
                    <p>
                      A contratação dos planos ainda está sendo habilitada.
                      Tente novamente mais tarde.
                    </p>
                  ) : (
                    <>
                      {data.pending_plan ? (
                        <div className="billing-confirmation">
                          <h3>Solicitação em andamento</h3>
                          <p>
                            {planById(data.pending_plan)?.label} ·{" "}
                            {formatAmount(
                              planById(data.pending_plan)?.amount || 0,
                            )}
                            /mês. As vagas são liberadas após a confirmação do
                            pagamento.
                          </p>
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              act(data.pending_action, data.pending_plan)
                            }
                          >
                            {busy
                              ? "Aguarde..."
                              : "Continuar ou verificar confirmação"}
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => act("cancel_pending")}
                          >
                            Cancelar solicitação pendente
                          </button>
                        </div>
                      ) : (
                        !trial &&
                        (!renewable || canChange) && (
                          <>
                            {confirming ? (
                              <div className="billing-confirmation">
                                <h3 ref={confirmationTitle} tabIndex={-1}>
                                  Confirmar{" "}
                                  {renewable ? "alteração" : "assinatura"}
                                </h3>
                                <p>
                                  <strong>
                                    {selectedPlan.label} ·{" "}
                                    {formatAmount(selectedPlan.amount)}/mês
                                  </strong>
                                  , incluindo o proprietário.
                                </p>
                                {renewable ? (
                                  selectedPlan.limit > currentPlan.limit ? (
                                    <p>
                                      Ao confirmar, será cobrada a diferença
                                      proporcional aos dias restantes do mês. A
                                      data de renovação permanece a mesma. As
                                      novas vagas serão liberadas após o
                                      pagamento.
                                    </p>
                                  ) : (
                                    <p>
                                      O limite menor passa a valer após a
                                      confirmação. O novo valor será cobrado na
                                      próxima renovação. Não haverá estorno do
                                      período atual.
                                    </p>
                                  )
                                ) : (
                                  <p>
                                    Você seguirá para o pagamento seguro na
                                    Stripe. A assinatura renova mensalmente e
                                    pode ser cancelada para o fim do período
                                    pago. Se tiver um cupom, informe o código na
                                    página de pagamento. Confira o desconto, sua
                                    duração e o valor final antes de concluir.
                                  </p>
                                )}
                                <div className="billing-actions">
                                  <button
                                    className="button primary"
                                    disabled={blocked}
                                    onClick={() =>
                                      act(renewable ? "change" : "checkout")
                                    }
                                  >
                                    {busy
                                      ? "Processando..."
                                      : "Confirmar e continuar"}
                                  </button>
                                  <button
                                    className="button secondary"
                                    disabled={busy}
                                    onClick={() => setConfirming(false)}
                                  >
                                    Voltar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="button primary"
                                disabled={
                                  blocked ||
                                  (renewable &&
                                    selectedPlan.id === data.plan_id)
                                }
                                onClick={() => setConfirming(true)}
                              >
                                {renewable && selectedPlan.id === data.plan_id
                                  ? "Plano atual"
                                  : `${renewable ? "Alterar" : "Assinar"} por ${formatAmount(selectedPlan.amount)}/mês`}
                              </button>
                            )}
                          </>
                        )
                      )}
                      {data.has_customer && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => act("portal")}
                        >
                          Gerenciar pagamento, faturas e cancelamento
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {!benefit && (
                <p className="micro">
                  Desativar um atendente preserva o histórico e não altera a
                  mensalidade automaticamente. Para pagar menos, escolha e
                  confirme um plano menor nesta tela.
                </p>
              )}
              <p className="micro">
                A Clara inclui até 30 perguntas com IA por dia por conta.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
