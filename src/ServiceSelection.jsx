import React from "react";
import { Check, Clock3 } from "lucide-react";
import { money, time } from "./domain";
import { summarizeServices, serviceSchedule } from "./service-selection";

export function ServicePicker({ services, selected, onChange }) {
  return (
    <fieldset className="multi-service-picker">
      <legend>Serviços do atendimento</legend>
      <p>Selecione um ou mais serviços, na ordem em que serão realizados.</p>
      {services
        .filter((s) => s.active || selected.includes(s.id))
        .map((s) => (
          <label
            key={s.id}
            className={selected.includes(s.id) ? "selected" : ""}
          >
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              disabled={
                !selected.includes(s.id) && (!s.active || selected.length >= 20)
              }
              onChange={() =>
                onChange(
                  selected.includes(s.id)
                    ? selected.filter((id) => id !== s.id)
                    : [...selected, s.id],
                )
              }
            />
            <span>
              <strong>{s.name}</strong>
              <small>
                {s.duration} min
                {!s.active
                  ? " · Arquivado — remova para alterar a reserva"
                  : ""}
              </small>
            </span>
            <b>{money(s.price)}</b>
          </label>
        ))}
    </fieldset>
  );
}

export function ServiceBreakdown({ items = [], startsAt }) {
  if (items.length < 2) return null;
  const schedule = serviceSchedule(items, startsAt);
  return (
    <ol className="service-breakdown" aria-label="Sequência de serviços">
      {items.map((s, i) => (
        <li key={s.id || i}>
          <span>{i + 1}</span>
          <div>
            <strong>{s.name}</strong>
            <small>
              {schedule
                ? `${time(schedule.items[i].starts_at)} – ${time(schedule.items[i].ends_at)}`
                : `${s.duration} min`}
            </small>
          </div>
          <b>{money(s.price)}</b>
        </li>
      ))}
    </ol>
  );
}

export function SelectionSummary({
  items,
  startsAt,
  buffer,
  internal = false,
}) {
  const total = summarizeServices(items);
  const schedule = serviceSchedule(items, startsAt, buffer);
  if (!items.length)
    return (
      <div className="note-box">
        Selecione pelo menos um serviço para continuar.
      </div>
    );
  return (
    <section className="selection-summary" aria-live="polite">
      <div className="selection-summary-head">
        <strong>
          {items.length}{" "}
          {items.length === 1 ? "serviço selecionado" : "serviços selecionados"}
        </strong>
        <b>{money(total.price)}</b>
      </div>
      <p>
        <Clock3 size={15} />
        {total.duration} min de atendimento
        {schedule && ` · ${time(startsAt)} até ${time(schedule.ends_at)}`}
      </p>
      <ServiceBreakdown items={items} startsAt={startsAt} />
      {internal && (
        <small>
          <Check size={13} /> Intervalo final: {buffer} min
          {schedule
            ? ` · Próximo horário a partir de ${time(schedule.free_at)}`
            : ""}
          . Sem intervalo entre os serviços.
        </small>
      )}
    </section>
  );
}
