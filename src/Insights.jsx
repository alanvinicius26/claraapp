import React, { useMemo } from "react";
import { TrendingUp, TrendingDown, Repeat2, Globe, Receipt } from "lucide-react";
import { money, shiftDate, today } from "./domain";
import "./insights.css";

export const localDay = (value) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const short = (value) =>
  new Date(value + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const weekday = (value) =>
  new Date(value + "T12:00:00")
    .toLocaleDateString("pt-BR", { weekday: "short" })
    .replace(".", "")
    .slice(0, 3);
const compact = (value) =>
  value >= 1000
    ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : money(value);
const percent = (value) => `${Math.round(value * 100)}%`;
const counts = (a) => !["cancelled", "blocked"].includes(a.status);

// Revenue per day for [from, to]; completed appointments are the realized
// value, confirmed ones are what the agenda still promises.
export function revenueByDay(appointments, from, to) {
  const days = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) days.push({ date: d, done: 0, planned: 0 });
  const index = new Map(days.map((x) => [x.date, x]));
  for (const a of appointments) {
    if (!counts(a) || !a.starts_at) continue;
    const day = index.get(localDay(a.starts_at));
    if (!day) continue;
    if (a.status === "completed") day.done += Number(a.price || 0);
    else day.planned += Number(a.price || 0);
  }
  return days;
}

export function BarChart({ data, label, highlight }) {
  const max = Math.max(1, ...data.map((x) => x.done + x.planned));
  return (
    <figure className="bar-chart" aria-label={label}>
      <div className="bar-chart-plot">
        {data.map((x, i) => {
          const step = data.length > 16 ? 3 : data.length > 9 ? 2 : 1;
          const total = x.done + x.planned;
          return (
            <div
              key={x.date}
              className={`bar-col ${x.date === highlight ? "is-today" : ""}`}
              title={`${short(x.date)} · ${money(total)}`}
            >
              <span className="bar-stack" style={{ height: `${(total / max) * 100}%` }}>
                {x.planned > 0 && (
                  <i className="bar planned" style={{ flexGrow: x.planned }} />
                )}
                {x.done > 0 && <i className="bar done" style={{ flexGrow: x.done }} />}
              </span>
              {((data.length - 1 - i) % step === 0) && (
                <small>{step > 1 ? Number(x.date.slice(-2)) : weekday(x.date)}</small>
              )}
            </div>
          );
        })}
      </div>
      <figcaption>
        <span><i className="dot done" /> Realizado</span>
        <span><i className="dot planned" /> Agendado</span>
      </figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((x) => (
            <tr key={x.date}>
              <th scope="row">{short(x.date)}</th>
              <td>{money(x.done + x.planned)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function businessPulse(appointments, end = today()) {
  const valid = appointments.filter((a) => counts(a) && a.starts_at);
  const within = (from, to) =>
    valid.filter((a) => {
      const d = localDay(a.starts_at);
      return d >= from && d <= to;
    });
  const done = (list) => list.filter((a) => a.status === "completed");
  const sum = (list) => list.reduce((t, a) => t + Number(a.price || 0), 0);
  // Full days only: today is still in progress and would skew the trend.
  const last7 = sum(done(within(shiftDate(end, -7), shiftDate(end, -1))));
  const prev7 = sum(done(within(shiftDate(end, -14), shiftDate(end, -8))));
  const month = within(shiftDate(end, -29), end);
  const monthDone = done(month);
  const visits = new Map();
  for (const a of monthDone) visits.set(a.client_id, (visits.get(a.client_id) || 0) + 1);
  const clientsSeen = [...visits.values()];
  return {
    last7,
    change: prev7 > 0 ? (last7 - prev7) / prev7 : null,
    ticket: monthDone.length ? sum(monthDone) / monthDone.length : 0,
    returning: clientsSeen.length
      ? clientsSeen.filter((n) => n >= 2).length / clientsSeen.length
      : null,
    online: month.length ? month.filter((a) => a.source === "online").length / month.length : null,
    monthCount: month.length,
  };
}

export function BusinessPulse({ appointments }) {
  const end = today();
  const pulse = useMemo(() => businessPulse(appointments, end), [appointments, end]);
  const chart = useMemo(
    () => revenueByDay(appointments, shiftDate(end, -13), end),
    [appointments, end],
  );
  if (!pulse.monthCount) return null;
  const Trend = pulse.change != null && pulse.change < 0 ? TrendingDown : TrendingUp;
  return (
    <section className="panel business-pulse" aria-label="Visão do negócio">
      <span className="eyebrow">VISÃO DO NEGÓCIO</span>
      <div className="pulse-headline">
        <div>
          <span>Faturamento · últimos 7 dias completos</span>
          <strong>{money(pulse.last7)}</strong>
        </div>
        {pulse.change != null && (
          <span className={`trend ${pulse.change < 0 ? "down" : "up"}`}>
            <Trend size={14} /> {pulse.change > 0 ? "+" : ""}
            {percent(pulse.change)}
          </span>
        )}
      </div>
      <BarChart data={chart} label="Faturamento dos últimos 14 dias" highlight={end} />
      <dl className="pulse-kpis">
        <div>
          <dt><Receipt size={15} /> Ticket médio</dt>
          <dd>{money(pulse.ticket)}</dd>
        </div>
        {pulse.returning != null && (
          <div>
            <dt><Repeat2 size={15} /> Clientes que voltam</dt>
            <dd>{percent(pulse.returning)}</dd>
          </div>
        )}
        {pulse.online != null && (
          <div>
            <dt><Globe size={15} /> Reservas online</dt>
            <dd>{percent(pulse.online)}</dd>
          </div>
        )}
      </dl>
      <p className="micro">Indicadores dos últimos 30 dias.</p>
    </section>
  );
}

export function PeriodInsights({ appointments, all = appointments, payments, from, to }) {
  const chart = useMemo(() => revenueByDay(all, from, to), [all, from, to]);
  const methods = useMemo(() => {
    const ids = new Set(appointments.map((a) => a.id));
    const totals = new Map();
    for (const p of payments) {
      if (!ids.has(p.appointment_id)) continue;
      const key = p.method || "Outro";
      totals.set(key, (totals.get(key) || 0) + Number(p.amount || 0));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [appointments, payments]);
  const received = methods.reduce((t, [, v]) => t + v, 0);
  if (!appointments.length) return null;
  return (
    <div className="period-insights">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Faturamento por dia</h2>
            <p>Realizado e agendado no período selecionado.</p>
          </div>
        </div>
        <BarChart
          data={chart}
          label="Faturamento por dia no período"
          highlight={today()}
        />
      </section>
      <section className="panel method-breakdown">
        <div className="section-head">
          <div>
            <h2>Formas de pagamento</h2>
            <p>{received ? compact(received) + " recebidos" : "Nenhum pagamento registrado"}</p>
          </div>
        </div>
        {methods.length ? (
          <ul>
            {methods.map(([name, value]) => (
              <li key={name}>
                <span>
                  {name}
                  <strong>{money(value)}</strong>
                </span>
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${(value / received) * 100}%` }} />
                </span>
                <small>{percent(value / received)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Registre pagamentos para ver a divisão por forma.</p>
        )}
      </section>
    </div>
  );
}
