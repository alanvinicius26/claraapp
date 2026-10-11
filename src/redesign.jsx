import React from "react";
import { BrandMark } from "./Brand";
import {
  CalendarDays,
  Users,
  Wallet,
  Flower2,
  Store,
  Copy,
  ArrowUpRight,
  Check,
  CreditCard,
  RotateCw,
  Wifi,
  LockKeyhole,
  MessageCircle,
  Clock3,
  Sparkles,
} from "lucide-react";
import { initials, money, shiftDate, time, today } from "./domain";
import { ServiceBreakdown } from "./ServiceSelection";

export function MobileNav({ prefix, page }) {
  return (
    <nav className="bottom-nav" aria-label="Navegação principal mobile">
      {[
        ["agenda", "Agenda", CalendarDays],
        ["clientes", "Clientes", Users],
        ["recebimentos", "Financeiro", Wallet],
        ["servicos", "Serviços", Flower2],
        ["espaco", "Perfil", Store],
      ].map(([key, label, Icon]) => (
        <a
          key={key}
          href={"#" + prefix + key}
          aria-current={page === key ? "page" : undefined}
          className={page === key ? "active" : ""}
        >
          <Icon size={21} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function WeekStrip({ day, setDay, appointments }) {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const start = shiftDate(day, -((weekday + 6) % 7));
  return (
    <div className="week-strip" aria-label="Dias da semana">
      {Array.from({ length: 7 }, (_, i) => shiftDate(start, i)).map((d) => (
        <button
          key={d}
          aria-pressed={d === day}
          aria-label={new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          className={d === day ? "selected" : ""}
          onClick={() => setDay(d)}
        >
          <small>
            {new Date(d + "T12:00:00")
              .toLocaleDateString("pt-BR", { weekday: "short" })
              .replace(".", "")}
          </small>
          <strong>{Number(d.slice(-2))}</strong>
          <span>
            {d === today()
              ? "Hoje"
              : appointments.some(
                    (a) =>
                      a.starts_at &&
                      new Date(a.starts_at).toLocaleDateString("en-CA", {
                        timeZone: "America/Sao_Paulo",
                      }) === d &&
                      !["cancelled", "blocked"].includes(a.status),
                  )
                ? "•"
                : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CatalogLink({ studio, copyLink, demo, compact = false }) {
  return (
    <section className={"catalog-link " + (compact ? "compact" : "")}>
      <span className="catalog-symbol">
        <BrandMark size={36} />
      </span>
      <div>
        <span className="eyebrow">
          {studio.active ? "SUA PÁGINA ESTÁ ATIVA" : "RESERVAS ONLINE PAUSADAS"}
        </span>
        <h2>Seu próximo atendimento começa aqui.</h2>
        <p>
          {demo
            ? "Seu catálogo, pronto para compartilhar."
            : `${location.host}/#/booking/${studio.slug}`}
        </p>
      </div>
      <div className="button-row">
        <button className="button primary" onClick={copyLink}>
          <Copy size={16} /> Copiar link
        </button>
        {!demo && (
          <a
            className="button secondary"
            href={`#/booking/${studio.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver como cliente <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    </section>
  );
}

export function AppointmentFocus({
  appointment: a,
  professionals = [],
  clients,
  appointments,
  paid,
  open,
  onComplete,
  saving,
  copyLink,
}) {
  if (!a)
    return (
      <section className="panel focus-empty">
        <Sparkles size={32} />
        <span className="eyebrow">UM DIA COM POSSIBILIDADES</span>
        <h2>Espaço para o próximo cuidado.</h2>
        <p>
          Selecione um atendimento para ver a ficha da cliente e acompanhar os
          detalhes.
        </p>
        <button className="button primary full" onClick={copyLink}>
          <Copy size={16} /> Compartilhar meu link
        </button>
      </section>
    );
  const client = clients.find((c) => c.id === a.client_id);
  const visits = appointments.filter(
    (x) => x.client_id === a.client_id && x.status === "completed",
  ).length;
  const payment = paid(a.id);
  const active =
    a.status === "confirmed" &&
    Date.now() >= new Date(a.starts_at).getTime() &&
    Date.now() < new Date(a.ends_at).getTime();
  const elapsed = Math.min(
    100,
    Math.max(
      0,
      (100 * (Date.now() - new Date(a.starts_at))) /
        (new Date(a.ends_at) - new Date(a.starts_at)),
    ),
  );
  return (
    <section
      className={"panel appointment-focus " + (active ? "in-progress" : "")}
      aria-label="Ficha do atendimento selecionado"
    >
      <div className="focus-heading">
        <span className="eyebrow">
          <span className="online-dot" />
          {active ? "ATENDIMENTO ATUAL" : "ATENDIMENTO EM FOCO"}
        </span>
        <h2>Ficha da cliente</h2>
      </div>
      <div className="focus-identity">
        <span className="avatar large">
          {initials(a.clients?.name || "Pausa")}
        </span>
        <div>
          <h3>{a.clients?.name || "Horário reservado"}</h3>
          <p>{professionals.find((p) => p.id === a.professional_id)?.name}</p>
          <p>{a.clients?.phone || "Contato não informado"}</p>
          {a.client_id && (
            <span className="visit-pill">
              {visits}{" "}
              {visits === 1 ? "visita concluída" : "visitas concluídas"}
            </span>
          )}
        </div>
      </div>
      <div className="focus-service">
        <div>
          <span>SERVIÇO</span>
          <strong>{a.service_name || "Bloqueio pessoal"}</strong>
        </div>
        <div>
          <span>VALOR TOTAL</span>
          <strong>{money(a.price)}</strong>
        </div>
        <p>
          <Clock3 size={15} /> Horário reservado{" "}
          <b>
            {time(a.starts_at)} – {time(a.ends_at)}
          </b>
        </p>
        <p>
          Pagamento{" "}
          <b>
            {payment
              ? `Recebido · ${payment.method}`
              : a.status === "cancelled"
                ? "Cancelado"
                : a.status === "blocked"
                  ? "Não se aplica"
                  : "A receber no local"}
          </b>
        </p>
      </div>
      {active && (
        <div className="elapsed">
          <span>Atendimento em andamento</span>
          <progress
            max="100"
            value={elapsed}
            aria-label="Tempo decorrido do atendimento"
          />
        </div>
      )}
      <ServiceBreakdown items={a.service_items} startsAt={a.starts_at} />
      <div className="focus-notes">
        <h3>
          <LockKeyhole size={15} /> Observações internas
        </h3>
        <p>{client?.notes || a.notes || "Nenhuma observação registrada."}</p>
        {client && (
          <button
            className="text-button"
            onClick={() => open("client", client)}
          >
            Editar ficha da cliente
          </button>
        )}
      </div>
      <div className="focus-actions">
        {a.status === "confirmed" && (
          <button
            className="button primary full"
            disabled={saving}
            onClick={() => onComplete(a)}
          >
            <Check size={18} /> Concluir atendimento
          </button>
        )}
        {["confirmed", "completed"].includes(a.status) && !payment && (
          <button
            className="button secondary full"
            onClick={() => open("payment", a)}
          >
            <Wallet size={18} /> Registrar {money(a.price)}
          </button>
        )}
        {a.clients?.phone && (
          <a
            className="button whatsapp full"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/55${a.clients.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`}
          >
            <MessageCircle size={18} /> Abrir WhatsApp
          </a>
        )}
        <button
          className="button secondary full"
          onClick={() => open("detail", a)}
        >
          Ver detalhes e gerenciar
        </button>
      </div>
    </section>
  );
}

