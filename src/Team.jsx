import React, { useEffect, useState } from "react";
import { supabase, query, rpc, errorMessage } from "./lib";

import Resources from "./Resources";
import ClaraArt from "./ClaraArt";
import HoursEditor from "./HoursEditor";
import { initials } from "./domain";
import { UserPlus } from "lucide-react";
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
  const used = Math.min(count, MAX_PROFESSIONALS);
  return (
    <>
      <div className="page-title clara-team-title">
        <ClaraArt className="clara-team-art" pose="right" loading="lazy" />
        <div>
          <span className="eyebrow">CADA PROFISSIONAL, SUA AGENDA</span>
          <h1>Equipe do salão</h1>
          <p>
            Gerencie horários independentes. Os serviços do catálogo são
            compartilhados pela equipe.
          </p>
        </div>
      </div>
      <section className="panel team-roster" aria-live="polite">
        <div className="team-roster-head">
          <div>
            <h2>Sua equipe</h2>
            <p>
              O proprietário ocupa a primeira vaga, mesmo com a agenda
              desativada. Somente os demais atendentes ativos ocupam vagas
              adicionais.
            </p>
          </div>
          <div className="team-meter" aria-label={`${count} de ${MAX_PROFESSIONALS} atendentes`}>
            <strong>
              {count}
              <small> de {MAX_PROFESSIONALS} atendentes</small>
            </strong>
            <span className="team-meter-track" aria-hidden="true">
              {Array.from({ length: MAX_PROFESSIONALS }, (_, i) => (
                <i key={i} className={i < used ? "on" : ""} />
              ))}
            </span>
          </div>
        </div>
        <div className="team-capacity">
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
        </div>
        <div className="team-cards" role="group" aria-label="Profissional para configurar">
          {professionals.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`team-card ${p.id === id ? "selected" : ""} ${p.active ? "" : "inactive"}`}
              aria-pressed={p.id === id}
              onClick={() => setSelected(p.id)}
            >
              <span className="avatar">{initials(p.name)}</span>
              <span className="team-card-text">
                <strong>{p.name}</strong>
                <small>
                  {p.is_default ? "Proprietária · " : ""}
                  {p.active ? "Atendendo" : "Inativa"}
                </small>
              </span>
              {p.accepts_parallel && <span className="team-chip">Encaixes</span>}
            </button>
          ))}
          <form
            className="team-card team-add"
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
            <label className="field">
              <span>Adicionar profissional</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                placeholder="Nome da profissional"
                disabled={!mayAdd}
              />
            </label>
            <button className="button primary" disabled={saving || !mayAdd}>
              <UserPlus size={16} /> Adicionar à equipe
            </button>
          </form>
        </div>
      </section>
      {person && (
        <div className="team-config">
          <form
            key={[person.id, person.name, person.active, person.accepts_parallel, person.parallel_online].join()}
            className="panel team-profile"
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
                  : {
                      name: f.get("name").trim(),
                      active,
                      accepts_parallel: f.get("accepts_parallel") === "on",
                      parallel_online:
                        f.get("accepts_parallel") === "on" &&
                        f.get("parallel_online") === "on",
                    };
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
            <div className="team-profile-head">
              <span className="avatar large">{initials(person.name)}</span>
              <div>
                <span className="eyebrow">DADOS DA PROFISSIONAL</span>
                <h2>{person.name}</h2>
              </div>
            </div>
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
            <ParallelFields person={person} />
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
            className="panel team-schedule"
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
            <span className="eyebrow">EXPEDIENTE INDIVIDUAL</span>
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
              <HoursEditor hours={hours} change={change} breakLabel="Pausa de almoço" />
            )}
            <button className="button primary" disabled={saving || !loaded}>
              Salvar expediente individual
            </button>
          </form>
        </div>
      )}
      <Resources
        studio={studio}
        protect={protect}
        mutate={mutate}
        saving={saving}
        demo={demo}
      />
    </>
  );
}

// "Faz encaixes": the online release only makes sense while encaixes are on.
function ParallelFields({ person }) {
  const [accepts, setAccepts] = useState(!!person.accepts_parallel);
  const [online, setOnline] = useState(!!person.parallel_online);
  return (
    <fieldset className="parallel-fields">
      <legend>Encaixes</legend>
      <label className="check-field">
        <input
          name="accepts_parallel"
          type="checkbox"
          checked={accepts}
          onChange={(e) => setAccepts(e.target.checked)}
        />{" "}
        Faz encaixes
      </label>
      <label className="check-field">
        <input
          name="parallel_online"
          type="checkbox"
          checked={accepts && online}
          onChange={(e) => setOnline(e.target.checked)}
          disabled={!accepts}
        />{" "}
        Liberar encaixes no agendamento online
      </label>
      <p className="micro">
        Com encaixes, esta profissional pode atender mais de uma pessoa ao mesmo
        tempo nos serviços marcados com “Posso atender outra pessoa junto”,
        até o limite de cada serviço. Sem a liberação online, só você marca
        encaixes pelo painel; as clientes veem apenas horários livres.
      </p>
    </fieldset>
  );
}
