import React, { useCallback, useEffect, useRef, useState } from "react";
import { rpc, errorMessage } from "./lib";
import { billingRequest, PLANS, planById, formatAmount } from "./billing";
import "./admin.css";

const date = (value) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Sem vencimento";
const initialCoupon = {
  code: "",
  type: "percent",
  value: "50",
  duration: "once",
  months: "3",
  max: "1",
  expires: "",
};
const localDate = (value) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const labelAction = {
  access_granted: "Acesso gratuito concedido ou atualizado",
  access_revoked: "Acesso gratuito encerrado",
  coupon_requested: "Criação de cupom solicitada",
  coupon_active: "Cupom ativado",
  coupon_inactive: "Cupom desativado",
};

export function AdminLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let current = true;
    const load = () =>
      rpc("platform_admin_status")
        .then((v) => {
          if (current) setAllowed(v === true);
        })
        .catch(() => {
          if (current) setAllowed(false);
        });
    load();
    window.addEventListener("focus", load);
    return () => {
      current = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  return allowed ? (
    <a href="#/admin">
      <span aria-hidden="true">⚙</span>
      <span>Administração</span>
    </a>
  ) : null;
}

function CouponSummary({ definition: d }) {
  return (
    <>
      {d.type === "percent" ? `${d.value}%` : formatAmount(d.value)} de desconto
      ·{" "}
      {d.duration === "once"
        ? "na primeira cobrança"
        : d.duration === "forever"
          ? "enquanto durar a assinatura"
          : `por ${d.months} meses`}{" "}
      ·{" "}
      {d.max_redemptions
        ? `até ${d.max_redemptions} ${d.max_redemptions === 1 ? "resgate" : "resgates"}`
        : "sem limite de resgates"}{" "}
      · resgate{" "}
      {d.expires_at ? `até ${date(d.expires_at * 1000)}` : "sem vencimento"}
    </>
  );
}

export default function Admin({ notify }) {
  const [access, setAccess] = useState("loading");
  const [tab, setTab] = useState("accounts");
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [benefit, setBenefit] = useState({
    kind: "courtesy",
    plan: "solo",
    expires: "",
    reason: "",
  });
  const [history, setHistory] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [config, setConfig] = useState(null);
  const [coupon, setCoupon] = useState(initialCoupon);
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false);
  const titleRef = useRef(null);
  const loadId = useRef(0);
  const selectionId = useRef(0);

  useEffect(() => {
    let current = true;
    setAccess("loading");
    rpc("platform_admin_status")
      .then((v) => {
        if (current) setAccess(v === true ? "allowed" : "denied");
      })
      .catch(() => {
        if (current) setAccess("error");
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    setFailure("");
    try {
      if (tab === "accounts") {
        const rows = await rpc("admin_accounts", {
          p_search: query.trim(),
          p_offset: offset,
        });
        if (id === loadId.current) setAccounts(rows);
      } else {
        const c = await billingRequest("status");
        const rows = await rpc("admin_coupons_list", { p_mode: c.mode });
        if (id === loadId.current) {
          setConfig(c);
          setCoupons(rows);
        }
      }
    } catch (e) {
      if (id === loadId.current) setFailure(errorMessage(e));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [tab, query, offset]);
  useEffect(() => {
    if (access === "allowed") load();
    return () => {
      loadId.current++;
    };
  }, [access, load, attempt]);
  useEffect(() => {
    if (confirmation) titleRef.current?.focus();
  }, [confirmation]);

  async function selectAccount(row) {
    const id = ++selectionId.current;
    setSelected(row);
    setConfirmation(null);
    setHistory([]);
    setBenefit({
      kind: row.benefit?.kind || "courtesy",
      plan: row.benefit?.plan_id || row.plan_id,
      expires: localDate(row.benefit?.expires_at),
      reason: row.benefit?.reason || "",
    });
    try {
      const rows = await rpc("admin_history", { p_owner: row.owner_id });
      if (id === selectionId.current) setHistory(rows);
    } catch (e) {
      if (id === selectionId.current) notify(errorMessage(e), true);
    }
  }
  async function perform(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (action.type === "grant") {
        await billingRequest("admin_access_set", {
          args: action.args,
          confirmed: true,
        });
        notify("Acesso gratuito atualizado.");
      } else if (action.type === "revoke") {
        await rpc("admin_revoke_access", action.args);
        notify(
          "Benefício encerrado. Outros períodos válidos da conta continuam disponíveis.",
        );
      } else {
        const result = await billingRequest(action.action, action.args);
        notify(result.message);
        if (action.action === "admin_coupon_inspect") {
          setCoupons((rows) =>
            rows.map((c) => (c.id === result.coupon.id ? result.coupon : c)),
          );
          setConfirmation(null);
          return;
        }
        if (action.action === "admin_coupon_create") setCoupon(initialCoupon);
      }
      setConfirmation(null);
      if (action.type === "grant" || action.type === "revoke") {
        setSelected(null);
        selectionId.current++;
      }
      await load();
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function prepareBenefit(e) {
    e.preventDefault();
    const expires = benefit.expires
      ? new Date(benefit.expires).toISOString()
      : null;
    if (expires && Date.parse(expires) <= Date.now())
      return notify("Escolha uma validade futura.", true);
    setConfirmation({
      type: "grant",
      args: {
        p_owner: selected.owner_id,
        p_kind: benefit.kind,
        p_plan: benefit.plan,
        p_expires: expires,
        p_reason: benefit.reason.trim(),
        p_expected: selected.benefit?.id || null,
      },
      text: `${selected.email || selected.studio_name}: liberar ${planById(benefit.plan)?.label}, ${expires ? `até ${date(expires)}` : "sem vencimento"}, sem cobrança. Ao terminar, continuam valendo apenas outros períodos válidos da conta. Nenhum cartão será cobrado por esta concessão.`,
    });
  }
  function prepareCoupon(e) {
    e.preventDefault();
    const definition = {
      type: coupon.type,
      value:
        coupon.type === "amount"
          ? Math.round(Number(coupon.value) * 100)
          : Number(coupon.value),
      duration: coupon.duration,
      months: coupon.duration === "repeating" ? Number(coupon.months) : null,
      max_redemptions: coupon.max ? Number(coupon.max) : null,
      expires_at: coupon.expires
        ? Math.floor(new Date(coupon.expires).getTime() / 1000)
        : null,
    };
    setConfirmation({
      action: "admin_coupon_create",
      args: {
        code: coupon.code.trim().toUpperCase(),
        definition,
        confirmed: true,
      },
      text: `Criar o cupom ${coupon.code.trim().toUpperCase()} no ambiente ${config.mode === "live" ? "real" : "de testes"}?`,
      definition,
    });
  }
  const blockedAccount =
    selected?.has_open_subscription || selected?.has_pending_operation;
  const switchTab = (value) => {
    if (busy) return;
    setTab(value);
    setConfirmation(null);
    setFailure("");
  };

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="eyebrow">CLARA · ACESSO EXCLUSIVO</span>
          <h1>Administração</h1>
          <p>Contas, acessos gratuitos e cupons de desconto.</p>
        </div>
        <a className="button secondary" href="#/app/agenda">
          Voltar ao meu espaço
        </a>
      </header>
      {access === "loading" ? (
        <p role="status">Verificando sua permissão...</p>
      ) : access === "denied" ? (
        <div className="admin-card">
          <h2>Acesso restrito</h2>
          <p>
            Esta área está disponível somente para a administração da Clara.
          </p>
        </div>
      ) : access === "error" ? (
        <div className="admin-card">
          <p role="alert">Não foi possível verificar sua permissão.</p>
          <button
            className="button secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <nav className="admin-tabs" aria-label="Seções da administração">
            <button
              className={`button ${tab === "accounts" ? "primary" : "secondary"}`}
              aria-current={tab === "accounts" ? "page" : undefined}
              disabled={busy}
              onClick={() => switchTab("accounts")}
            >
              Contas e acessos
            </button>
            <button
              className={`button ${tab === "coupons" ? "primary" : "secondary"}`}
              aria-current={tab === "coupons" ? "page" : undefined}
              disabled={busy}
              onClick={() => switchTab("coupons")}
            >
              Cupons
            </button>
          </nav>
          {failure && (
            <div role="alert" className="notice error">
              {failure} <button onClick={load}>Tentar novamente</button>
            </div>
          )}
          {loading && <p role="status">Atualizando dados...</p>}
          {confirmation && (
            <section
              className="admin-card admin-confirm"
              aria-labelledby="admin-confirm-title"
            >
              <h2 id="admin-confirm-title" ref={titleRef} tabIndex={-1}>
                Confirmar alteração
              </h2>
              <p>{confirmation.text}</p>
              {confirmation.definition && (
                <p>
                  <CouponSummary definition={confirmation.definition} />
                </p>
              )}
              <div className="admin-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => perform(confirmation)}
                >
                  {busy ? "Salvando..." : "Confirmar"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirmation(null)}
                >
                  Voltar
                </button>
              </div>
            </section>
          )}
          {tab === "accounts" ? (
            <div className="admin-layout">
              <section className="admin-card">
                <h2>Localizar conta</h2>
                <form
                  className="admin-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setQuery(search);
                    setOffset(0);
                    setSelected(null);
                    setConfirmation(null);
                    selectionId.current++;
                    if (search === query && offset === 0) load();
                  }}
                >
                  <label>
                    E-mail ou nome do espaço
                    <input
                      value={search}
                      maxLength={254}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy || loading}
                  >
                    Buscar
                  </button>
                </form>
                {!loading && !failure && !accounts.length && (
                  <p>Nenhuma conta encontrada.</p>
                )}
                <div className="admin-accounts">
                  {accounts.slice(0, 25).map((row) => (
                    <button
                      key={row.owner_id}
                      className={`admin-account ${selected?.owner_id === row.owner_id ? "selected" : ""}`}
                      disabled={busy}
                      onClick={() => selectAccount(row)}
                    >
                      <strong>{row.studio_name}</strong>
                      <span>{row.email || "E-mail indisponível"}</span>
                      <small>
                        {row.team_size} atendente(s) ·{" "}
                        {row.can_use ? "Acesso disponível" : "Acesso encerrado"}
                        {row.benefit ? " · Benefício registrado" : ""}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="admin-actions">
                  <button
                    className="button secondary"
                    disabled={busy || loading || offset === 0}
                    onClick={() => {
                      setOffset((v) => Math.max(0, v - 25));
                      setSelected(null);
                    }}
                  >
                    Anterior
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || loading || accounts.length < 26}
                    onClick={() => {
                      setOffset((v) => v + 25);
                      setSelected(null);
                    }}
                  >
                    Próxima
                  </button>
                </div>
              </section>
              <section className="admin-card">
                {!selected ? (
                  <>
                    <h2>Acesso gratuito</h2>
                    <p>
                      Selecione uma conta para conceder uma cortesia, definir um
                      período gratuito ou consultar o histórico.
                    </p>
                  </>
                ) : (
                  <>
                    <h2>{selected.studio_name}</h2>
                    <p>{selected.email}</p>
                    <p>
                      {selected.team_size} atendente(s) ativo(s) · limite atual:{" "}
                      {selected.effective_limit}.
                    </p>
                    {selected.benefit && (
                      <p className="notice">
                        Benefício registrado:{" "}
                        {planById(selected.benefit.plan_id)?.label} ·{" "}
                        {date(selected.benefit.expires_at)}
                        {selected.benefit.expires_at &&
                        Date.parse(selected.benefit.expires_at) <= Date.now()
                          ? " · Expirado"
                          : ""}
                        .
                      </p>
                    )}
                    {blockedAccount && (
                      <p className="notice">
                        {selected.has_open_subscription
                          ? "Existe uma assinatura em andamento. A cortesia poderá ser concedida depois do encerramento efetivo, para evitar cobranças durante o acesso gratuito."
                          : "Existe uma contratação pendente. A pessoa deve concluí-la ou cancelá-la em Minha assinatura antes de receber gratuidade."}
                      </p>
                    )}
                    <form onSubmit={prepareBenefit}>
                      <fieldset disabled={busy || blockedAccount}>
                        <label>
                          Tipo de benefício
                          <select
                            value={benefit.kind}
                            onChange={(e) =>
                              setBenefit((v) => ({
                                ...v,
                                kind: e.target.value,
                              }))
                            }
                          >
                            <option value="courtesy">Conta cortesia</option>
                            <option value="free_period">
                              Período gratuito
                            </option>
                          </select>
                        </label>
                        <label>
                          Plano liberado
                          <select
                            value={benefit.plan}
                            onChange={(e) =>
                              setBenefit((v) => ({
                                ...v,
                                plan: e.target.value,
                              }))
                            }
                          >
                            {PLANS.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={p.limit < selected.team_size}
                              >
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Válido até (horário deste dispositivo)
                          <input
                            type="datetime-local"
                            required={benefit.kind === "free_period"}
                            value={benefit.expires}
                            onChange={(e) =>
                              setBenefit((v) => ({
                                ...v,
                                expires: e.target.value,
                              }))
                            }
                          />
                        </label>
                        {benefit.kind === "courtesy" && (
                          <p className="micro">
                            Deixe a validade vazia para uma cortesia sem
                            vencimento.
                          </p>
                        )}
                        <label>
                          Motivo interno
                          <textarea
                            required
                            minLength={3}
                            maxLength={500}
                            value={benefit.reason}
                            onChange={(e) =>
                              setBenefit((v) => ({
                                ...v,
                                reason: e.target.value,
                              }))
                            }
                            placeholder="Ex.: parceria para testar a Clara"
                          />
                        </label>
                        <button className="button primary">
                          {selected.benefit
                            ? "Revisar atualização do benefício"
                            : "Revisar acesso gratuito"}
                        </button>
                      </fieldset>
                    </form>
                    {selected.benefit && (
                      <div className="admin-revoke">
                        <label>
                          Motivo do encerramento
                          <input
                            id="admin-revoke-reason"
                            maxLength={500}
                            minLength={3}
                            disabled={busy}
                            placeholder="Informe por que deseja encerrar"
                          />
                        </label>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            const reason = document
                              .getElementById("admin-revoke-reason")
                              .value.trim();
                            if (reason.length < 3)
                              return notify(
                                "Informe o motivo do encerramento.",
                                true,
                              );
                            setConfirmation({
                              type: "revoke",
                              args: {
                                p_owner: selected.owner_id,
                                p_expected: selected.benefit.id,
                                p_reason: reason,
                              },
                              text: `Encerrar o benefício de ${selected.email || selected.studio_name}? Outros períodos válidos continuam disponíveis. Sem outro período válido, a conta passa a permitir somente consulta e regularização.`,
                            });
                          }}
                        >
                          Encerrar benefício
                        </button>
                      </div>
                    )}
                    <h3>Histórico da conta</h3>
                    {!history.length ? (
                      <p>Nenhuma alteração administrativa registrada.</p>
                    ) : (
                      <ol className="admin-history">
                        {history.map((h) => (
                          <li key={h.id}>
                            <strong>{labelAction[h.action] || h.action}</strong>
                            <span>{date(h.created_at)}</span>
                            <p>{h.details.after?.reason || h.details.reason}</p>
                            {h.details.after && (
                              <small>
                                {planById(h.details.after.plan_id)?.label} ·{" "}
                                {date(h.details.after.expires_at)}
                              </small>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    {history.length > 0 && history.length % 25 === 0 && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={async () => {
                          try {
                            const rows = await rpc("admin_history", {
                              p_owner: selected.owner_id,
                              p_before: history.at(-1).id,
                            });
                            setHistory((v) => [...v, ...rows]);
                            if (!rows.length) notify("Fim do histórico.");
                          } catch (e) {
                            notify(errorMessage(e), true);
                          }
                        }}
                      >
                        Ver histórico anterior
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>
          ) : (
            <div className="admin-layout">
              <section className="admin-card">
                <h2>Criar cupom</h2>
                <p>
                  {config?.mode === "live"
                    ? "Ambiente real: os cupons alteram o valor de novas assinaturas."
                    : "Ambiente de testes: use apenas dados fictícios."}
                </p>
                <p>
                  O cliente informa o código na página de pagamento ao
                  contratar. Desativar o código impede novos resgates; descontos
                  já aplicados continuam válidos.
                </p>
                <form onSubmit={prepareCoupon}>
                  <fieldset disabled={busy || loading || !config?.configured}>
                    <label>
                      Código
                      <input
                        required
                        pattern="[A-Za-z0-9]{3,32}"
                        maxLength={32}
                        value={coupon.code}
                        onChange={(e) =>
                          setCoupon((v) => ({
                            ...v,
                            code: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="Ex.: BEMVINDA50"
                      />
                    </label>
                    <div className="admin-fields">
                      <label>
                        Tipo
                        <select
                          value={coupon.type}
                          onChange={(e) =>
                            setCoupon((v) => ({ ...v, type: e.target.value }))
                          }
                        >
                          <option value="percent">Percentual (%)</option>
                          <option value="amount">Valor em reais (R$)</option>
                        </select>
                      </label>
                      <label>
                        Desconto
                        <input
                          required
                          type="number"
                          min={coupon.type === "percent" ? 1 : 0.01}
                          max={coupon.type === "percent" ? 100 : 99.9}
                          step={coupon.type === "percent" ? 1 : 0.01}
                          value={coupon.value}
                          onChange={(e) =>
                            setCoupon((v) => ({ ...v, value: e.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Duração do desconto
                      <select
                        value={coupon.duration}
                        onChange={(e) =>
                          setCoupon((v) => ({ ...v, duration: e.target.value }))
                        }
                      >
                        <option value="once">Primeira cobrança</option>
                        <option value="repeating">Número de meses</option>
                        <option value="forever">
                          Enquanto durar a assinatura
                        </option>
                      </select>
                    </label>
                    {coupon.duration === "repeating" && (
                      <label>
                        Quantidade de meses
                        <input
                          type="number"
                          min="1"
                          max="36"
                          required
                          value={coupon.months}
                          onChange={(e) =>
                            setCoupon((v) => ({ ...v, months: e.target.value }))
                          }
                        />
                      </label>
                    )}
                    <label>
                      Limite total de resgates
                      <input
                        type="number"
                        min="1"
                        max="1000000"
                        value={coupon.max}
                        placeholder="Vazio = sem limite"
                        onChange={(e) =>
                          setCoupon((v) => ({ ...v, max: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Prazo para resgatar (horário deste dispositivo)
                      <input
                        type="datetime-local"
                        value={coupon.expires}
                        onChange={(e) =>
                          setCoupon((v) => ({ ...v, expires: e.target.value }))
                        }
                      />
                    </label>
                    <p className="micro">
                      O prazo de resgate é diferente da duração do desconto. A
                      pessoa vê o valor final e as condições antes de confirmar
                      o pagamento.
                    </p>
                    <button className="button primary">Revisar cupom</button>
                  </fieldset>
                </form>
              </section>
              <section className="admin-card">
                <div className="admin-actions">
                  <h2>Cupons cadastrados</h2>
                  <button
                    className="button secondary"
                    disabled={busy || loading}
                    onClick={load}
                  >
                    Atualizar lista
                  </button>
                </div>
                {!coupons.length && !loading && (
                  <p>Nenhum cupom cadastrado neste ambiente.</p>
                )}
                {coupons.map((c) => (
                  <article className="admin-coupon" key={c.id}>
                    <h3>{c.code}</h3>
                    <p>
                      <CouponSummary definition={c.definition} />
                    </p>
                    <p>
                      {c.state === "pending"
                        ? "Criação pendente: retome para concluir."
                        : c.state === "inactive"
                          ? "Inativo para novos resgates."
                          : c.definition.expires_at &&
                              c.definition.expires_at * 1000 <= Date.now()
                            ? "Prazo de resgate encerrado."
                            : "Criado. Consulte os usos para verificar a disponibilidade atual."}
                      {c.times_redeemed !== undefined &&
                        ` Resgates: ${c.times_redeemed}.`}
                    </p>
                    <div className="admin-actions">
                      {c.state === "pending" ? (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            perform({
                              action: "admin_coupon_resume",
                              args: { id: c.id, confirmed: true },
                            })
                          }
                        >
                          Retomar criação
                        </button>
                      ) : (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            perform({
                              action: "admin_coupon_inspect",
                              args: { id: c.id, confirmed: true },
                            })
                          }
                        >
                          Consultar usos
                        </button>
                      )}
                      {c.state === "active" && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              action: "admin_coupon_disable",
                              args: { id: c.id, confirmed: true },
                              text: `Desativar ${c.code} para novos resgates? Os descontos de quem já usou o cupom serão preservados.`,
                            })
                          }
                        >
                          Desativar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {coupons.length > 0 && coupons.length % 50 === 0 && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const rows = await rpc("admin_coupons_list", {
                          p_mode: config.mode,
                          p_before: coupons.at(-1).created_at,
                        });
                        setCoupons((v) => [...v, ...rows]);
                        if (!rows.length) notify("Fim da lista.");
                      } catch (e) {
                        notify(errorMessage(e), true);
                      }
                    }}
                  >
                    Ver cupons anteriores
                  </button>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
