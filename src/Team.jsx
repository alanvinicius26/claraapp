import React, { useEffect, useState } from "react";
import { supabase, query, rpc, errorMessage } from "./lib";

import Resources from "./Resources";
import {
  MAX_PROFESSIONALS,
  teamSize,
  planForCount,
  formatAmount,
} from "./billing";
import "./billing-plans.css";

const days = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const defaults = () =>
  days.map((_, weekday) => ({
    weekday,
    enabled: weekday !== 0,
    opens: "09:00",
    closes: "18:00",
    break_start: "12:00",
    break_end: "13:00",
  }));

export default function Team({
  studio,
  professionals,
  protect,
  mutate,
  saving,
  notify,
  demo,
}) {
  const [selected, setSelected] = useState("");
  const id = selected || professionals[0]?.id;
  const person = professionals.find((p) => p.id === id);
  const [hours, setHours] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [inherited, setInherited] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [capacity, setCapacity] = useState(
    demo ? { effective_limit: MAX_PROFESSIONALS, can_use: true } : null,
  );
  const [capacityError, setCapacityError] = useState(false);
  const count = teamSize(professionals);
  const full = count >= MAX_PROFESSIONALS;
  const mayAdd =
    !!capacity &&
    !capacityError &&
    capacity.can_use &&
    count < Math.min(MAX_PROFESSIONALS, capacity.effective_limit ?? 0);
  const nextPlan = planForCount(count + 1);
  useEffect(() => {
    if (demo) return;
    let current = true;
    const load = () =>
      rpc("billing_status")
        .then((value) => {
          if (current) {
            setCapacity(value.plans_version === 2 ? value : null);
            setCapacityError(value.plans_version !== 2);
          }
        })
        .catch(() => {
          if (current) setCapacityError(true);
        });
    load();
    window.addEventListener("focus", load);
    return () => {
      current = false;
      window.removeEventListener("focus", load);
    };
  }, [demo, professionals, retry]);
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setError(false);
    if (!id) return;
    if (demo) {
      setHours(defaults());
      setLoaded(true);
      return;
    }
    Promise.all([
      query(
        supabase.from("working_hours").select("*").eq("studio_id", studio.id),
      ),
      query(
        supabase
          .from("professional_hours")
          .select("*")
          .eq("professional_id", id)
          .eq("studio_id", studio.id),
      ),
    ])
      .then(([base, custom]) => {
        if (!current) return;
        setHours(
          defaults().map(
            (day) =>
              custom.find((h) => h.weekday === day.weekday) ||
              base.find((h) => h.weekday === day.weekday) || {
                ...day,
                enabled: false,
              },
          ),
        );
        setInherited(!custom.length);
        setLoaded(true);
      })
      .catch((e) => {
        if (current) {
          setError(true);
          notify(errorMessage(e), true);
        }
      });
    return () => {
      current = false;
    };
  }, [id, studio.id, demo, retry]);
  const change = (weekday, field, value) =>
    setHours((rows) =>
      rows.map((h) => (h.weekday === weekday ? { ...h, [field]: value } : h)),
    );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">CADA PROFISSIONAL, SUA AGENDA</span>
          <h1>Equipe do salão</h1>
          <p>
            Gerencie horários independentes. Os serviços do catálogo são
            compartilhados pela equipe.
          </p>
        </div>
      </div>
      <section className="panel team-capacity" aria-live="polite">
        <h2>
          {count} de {MAX_PROFESSIONALS} atendentes
        </h2>
        <p>
          O proprietário ocupa a primeira vaga, mesmo com a agenda desativada.
          Somente os demais atendentes ativos ocupam vagas adicionais.
        </p>
        {capacityError ? (
          <>
            <p>Não foi possível consultar o limite do plano.</p>
            <button
              className="button secondary"
              onClick={() => setRetry((n) => n + 1)}
            >
              Consultar limite novamente
            </button>
          </>
        ) : !capacity ? (
          <p>Consultando seu plano...</p>
        ) : full ? (
          <p>
            Você atingiu o limite de cinco atendentes. Desative um atendente
            adicional antes de adicionar outro.
          </p>
        ) : !mayAdd ? (
          <>
            <p>
              {capacity.can_use && nextPlan
                ? `Para ampliar a equipe, escolha o plano de ${formatAmount(nextPlan.amount)}/mês em Minha assinatura.`
                : "Regularize sua assinatura para adicionar atendentes. Você pode desativar os excedentes mantendo o histórico."}
            </p>
            <a
              className="button secondary"
              href={demo ? "#/demo/assinatura" : "#/app/assinatura"}
            >
              Ver planos e assinatura
            </a>
          </>
        ) : (
          <p>
            Você pode usar até {capacity.effective_limit} atendentes no acesso
            atual. Adicionar alguém não faz cobranças automáticas.
          </p>
        )}
      </section>
      <Resources
        studio={studio}
        protect={protect}
        mutate={mutate}
        saving={saving}
        demo={demo}
      />
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mayAdd) return;
          const form = e.currentTarget;
          const name = new FormData(form).get("name").trim();
          protect(() =>
            mutate(async () => {
              await query(
                supabase
                  .from("professionals")
                  .insert({ studio_id: studio.id, name }),
              );
              form.reset();
            }, "Profissional adicionada."),
          );
        }}
      >
        <h2>Adicionar profissional</h2>
        <label className="field">
          <span>Nome</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            disabled={!mayAdd}
          />
        </label>
        <button className="button primary" disabled={saving || !mayAdd}>
          Adicionar à equipe
        </button>
      </form>
      <label className="field">
        <span>Profissional para configurar</span>
        <select value={id || ""} onChange={(e) => setSelected(e.target.value)}>
          {professionals.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
              {p.active ? "" : " (inativa)"}
            </option>
          ))}
        </select>
      </label>
      {person && (
        <>
          <form
            key={person.id + person.name + person.active}
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const active = f.get("active") === "on";
              if (!person.active && active && !person.is_default && !mayAdd) {
                notify("Abra Minha assinatura para liberar esta vaga.", true);
                return;
              }
              const values =
                !capacity?.can_use && person.active && !active
                  ? { active: false }
                  : { name: f.get("name").trim(), active };
              protect(() =>
                mutate(
                  () =>
                    query(
                      supabase
                        .from("professionals")
                        .update(values)
                        .eq("id", person.id),
                    ),
                  "Profissional atualizada.",
                ),
              );
            }}
          >
            <h2>Dados da profissional</h2>
            <label className="field">
              <span>Nome de exibição</span>
              <input
                name="name"
                defaultValue={person.name}
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="check-field">
              <input
                name="active"
                type="checkbox"
                defaultChecked={person.active}
                disabled={!person.active && !person.is_default && !mayAdd}
              />{" "}
              Disponível para novos agendamentos
            </label>
            <p className="micro">
              Desativar mantém os atendimentos e o histórico existentes. Confira
              a agenda antes de desativar. A mensalidade só muda quando você
              confirma outro plano em Minha assinatura.
            </p>
            <button className="button primary" disabled={saving}>
              Salvar profissional
            </button>
          </form>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              protect(() =>
                mutate(async () => {
                  await rpc("save_professional_hours", {
                    p_professional: id,
                    p_hours: hours.map(
                      ({
                        weekday,
                        enabled,
                        opens,
                        closes,
                        break_start,
                        break_end,
                      }) => ({
                        weekday,
                        enabled,
                        opens,
                        closes,
                        break_start,
                        break_end,
                      }),
                    ),
                  });
                  setInherited(false);
                }, "Expediente da profissional salvo."),
              );
            }}
          >
            <h2>Expediente de {person.name}</h2>
            <p>
              {inherited
                ? "Por enquanto segue o expediente do salão. Salve para ter uma configuração independente."
                : "Este expediente é exclusivo desta profissional."}
            </p>
            {error ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => setRetry((n) => n + 1)}
              >
                Tentar carregar expediente novamente
              </button>
            ) : !loaded ? (
              <p>Carregando expediente...</p>
            ) : (
              <div className="team-hours">
                {hours.map((h) => (
                  <fieldset key={h.weekday}>
                    <legend>{days[h.weekday]}</legend>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={h.enabled}
                        onChange={(e) =>
                          change(h.weekday, "enabled", e.target.checked)
                        }
                      />{" "}
                      Atende neste dia
                    </label>
                    <div className="form-row">
                      <label className="field">
                        <span>Início</span>
                        <input
                          type="time"
                          required
                          disabled={!h.enabled}
                          value={h.opens.slice(0, 5)}
                          onChange={(e) =>
                            change(h.weekday, "opens", e.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Fim</span>
                        <input
                          type="time"
                          required
                          disabled={!h.enabled}
                          value={h.closes.slice(0, 5)}
                          onChange={(e) =>
                            change(h.weekday, "closes", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={!h.enabled}
                        checked={!!h.break_start}
                        onChange={(e) => {
                          change(
                            h.weekday,
                            "break_start",
                            e.target.checked ? "12:00" : null,
                          );
                          change(
                            h.weekday,
                            "break_end",
                            e.target.checked ? "13:00" : null,
                          );
                        }}
                      />{" "}
                      Pausa de almoço
                    </label>
                    {h.break_start != null && (
                      <div className="form-row">
                        <label className="field">
                          <span>Início da pausa</span>
                          <input
                            type="time"
                            required
                            disabled={!h.enabled}
                            value={h.break_start.slice(0, 5)}
                            onChange={(e) =>
                              change(h.weekday, "break_start", e.target.value)
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Fim da pausa</span>
                          <input
                            type="time"
                            required
                            disabled={!h.enabled}
                            value={(h.break_end || "").slice(0, 5)}
                            onChange={(e) =>
                              change(h.weekday, "break_end", e.target.value)
                            }
                          />
                        </label>
                      </div>
                    )}
                  </fieldset>
                ))}
              </div>
            )}
            <button className="button primary" disabled={saving || !loaded}>
              Salvar expediente individual
            </button>
          </form>
        </>
      )}
    </>
  );
}
