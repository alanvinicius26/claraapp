import React, { useEffect, useState, useRef } from "react";
import Brand, { BrandMark } from "./Brand";
import { canShareLinks, sharingUnavailable } from "./sharing";
import { whatsappEnabled } from "./features";
import {
  Flower2,
  ShieldCheck,
  Clock3,
  Check,
  ArrowLeft,
  ArrowRight,
  MapPin,
  Copy,
  CalendarDays,
  MessageCircle,
  LoaderCircle,
  X,
  CircleCheck,
} from "lucide-react";
import { rpc, errorMessage } from "./lib";
import { SelectionSummary, ServiceBreakdown } from "./ServiceSelection";
import { summarizeServices } from "./service-selection";
import { findNextDates } from "./availability";
import { canManageBooking, changeDeadlinePassed, changeNoticeLabel } from "./booking-policy";
import { normalizePhone, validPhone } from "./contact";
import {
  money,
  today,
  time,
  dateLabel,
  shiftDate,
  initials,
  download,
} from "./domain";
const go = (path) => {
  location.hash = path;
};
const Spinner = () => (
  <div className="loading">
    <LoaderCircle className="spin" /> Buscando horários...
  </div>
);
function PublicShell({ children }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span>
          <ShieldCheck size={14} /> Seu momento de cuidado
        </span>
      </header>
      <main>{children}</main>
      <footer>
        <BrandMark size={26} />
        <span>Agendado com cuidado, pela Clara.</span>
        <a href="#/">
          Sou profissional <ArrowRight size={13} />
        </a>
      </footer>
    </div>
  );
}
function DateSlots({
  slug,
  professionalId,
  serviceIds,
  token,
  date,
  setDate,
  selected,
  setSelected,
  notify,
  horizon = 90,
  refresh = 0,
}) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [searchAfter, setSearchAfter] = useState(null);
  const [alternatives, setAlternatives] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const serviceKey = serviceIds.join(",");
  useEffect(() => {
    const refreshVisible = () => {
      if (!document.hidden) setRetry((n) => n + 1);
    };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    setAlternatives(null);
    setSearchAfter(null);
    setSelected("");
    rpc("available_slots_team", {
      p_slug: slug,
      p_services: serviceKey.split(","),
      p_date: date,
      p_token: token || null,
      p_professional: professionalId || null,
    })
      .then((data) => {
        if (current) setSlots(data || []);
      })
      .catch((e) => {
        if (current) {
          setSlots([]);
          setFailed(true);
          notify(errorMessage(e), true);
        }
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [slug, professionalId, serviceKey, token, date, refresh, retry]);
  useEffect(() => {
    if (loading || failed || slots.length) return;
    let current = true;
    setSearching(true);
    setSearchFailed(false);
    findNextDates({
      after: searchAfter || date,
      until: shiftDate(today(), horizon),
      isCurrent: () => current,
      fetchRange: (after, until) => rpc("available_dates_team", {
        p_slug: slug,
        p_services: serviceKey.split(","),
        p_after: after,
        p_until: until,
        p_token: token || null,
        p_professional: professionalId || null,
      }),
    }).then((result) => {
      if (current && result) setAlternatives(result);
    }).catch(() => {
      if (current) setSearchFailed(true);
    }).finally(() => {
      if (current) setSearching(false);
    });
    return () => { current = false; };
  }, [loading, failed, slots, slug, professionalId, serviceKey, token, date, horizon, searchAfter, refresh, retry]);
  return (
    <>
      <div className="booking-date-head">
        <h3>Escolha o dia</h3>
        <input
          aria-label="Data do atendimento"
          type="date"
          min={today()}
          max={shiftDate(today(), horizon)}
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </div>
      <div className="date-strip">
        {Array.from({ length: 6 }, (_, i) => shiftDate(today(), i))
          .filter((d) => d <= shiftDate(today(), horizon))
          .map((d) => (
            <button
              type="button"
              key={d}
              className={date === d ? "selected" : ""}
              onClick={() => setDate(d)}
            >
              <small>
                {new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
                  weekday: "short",
                })}
              </small>
              <strong>{Number(d.slice(-2))}</strong>
              <span>{d === today() ? "Hoje" : " "}</span>
            </button>
          ))}
      </div>
      <h3 className="slots-title">
        Horários livres <span>{dateLabel(date)}</span>
      </h3>
      <p className="micro">Horários de São Paulo. A disponibilidade é conferida novamente ao confirmar.</p>
      {loading ? (
        <Spinner />
      ) : failed ? (
        <div className="note-box" role="alert">
          Não foi possível consultar os horários.
          <button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : slots.length ? (
        <div className="slots">
          {slots.map((s) => (
            <button
              type="button"
              key={s.starts_at}
              onClick={() => setSelected(s.starts_at)}
              className={selected === s.starts_at ? "selected" : ""}
            >
              {selected === s.starts_at ? (
                <Check size={15} />
              ) : (
                <Clock3 size={15} />
              )}{" "}
              {time(s.starts_at)}
            </button>
          ))}
        </div>
      ) : (
        <div className="next-dates" aria-live="polite" aria-busy={searching}>
          <div className="note-box">
            Não há tempo disponível para todos os serviços neste dia.
          </div>
          {searching ? <Spinner /> : searchFailed ? (
            <div className="note-box">
              Não foi possível buscar outras datas. Tente novamente ou escolha um dia no calendário.
              <button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>
            </div>
          ) : alternatives && (
            <>
              {alternatives.dates.length ? (
                <>
                  <h3>Próximos dias disponíveis</h3>
                  <p>Há espaço para o atendimento completo nestes dias. Escolha um para ver os horários.</p>
                  <div className="next-date-options">
                    {alternatives.dates.map((option) => (
                      <button type="button" className="button secondary" key={option.date} onClick={() => setDate(option.date)}>
                        <CalendarDays size={18} />
                        <span>{dateLabel(option.date)}<small>Primeiro horário: {time(option.first)}</small></span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>{alternatives.hasMore
                  ? `Nenhuma opção encontrada até ${dateLabel(alternatives.through)}.`
                  : "Não encontramos outros dias com espaço dentro do período aberto para reservas. Fale com o estúdio ou ajuste os serviços."}</p>
              )}
              {alternatives.hasMore && (
                <button type="button" className="text-button" onClick={() => setSearchAfter(alternatives.through)}>Buscar mais datas <ArrowRight size={15} /></button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
export function Booking({ slug, notify }) {
  const [attempt, setAttempt] = useState(0);
  const [professionalId, setProfessionalId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const selectedServices = serviceIds
    .map((id) => data?.services.find((s) => s.id === id))
    .filter(Boolean);
  const service = selectedServices.length
    ? summarizeServices(selectedServices)
    : null;
  const [date, setDate] = useState(today());
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const slotsRef = useRef(null);
  const contactRef = useRef(null);
  const bookingRequest = useRef(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setServiceIds([]);
    setSelected("");
    rpc("booking_page", { p_slug: slug })
      .then((d) => {
        if (!current) return;
        setData(d);
        setProfessionalId(d?.professionals?.[0]?.id || "");
        setSelected("");
        if (!d)
          setError("Não encontramos este estúdio. Confira o link recebido.");
      })
      .catch((e) => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [slug, attempt]);
  async function book(e) {
    e.preventDefault();
    if (!selected || busy) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (f.website) return;
    if (!validPhone(f.phone)) {
      notify("Informe um WhatsApp válido com DDD.", true);
      return;
    }
    setBusy(true);
    setSubmitError("");
    try {
      const args = {
        p_slug: slug,
        p_services: serviceIds,
        p_professional: professionalId,
        p_start: selected,
        p_name: f.name,
        p_email: (f.email || "").trim(),
        p_phone: normalizePhone(f.phone),
        p_notes: f.notes || "",
      };
      let result;
      if (whatsappEnabled) {
        // Standby service: per-booking consent and replay-safe request id.
        args.p_whatsapp_opt_in = f.whatsapp_opt_in === "on";
        const fingerprint = JSON.stringify(args);
        if (bookingRequest.current?.fingerprint !== fingerprint) {
          bookingRequest.current = { fingerprint, id: crypto.randomUUID() };
        }
        result = await rpc("book_appointment_whatsapp", { ...args, p_request_id: bookingRequest.current.id });
      } else {
        result = await rpc("book_appointment_team", args);
      }
      go("/manage/" + result.token);
    } catch (err) {
      setSubmitError(errorMessage(err));
      notify(errorMessage(err), true);
      setRefresh((x) => x + 1);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <PublicShell>
        <Spinner />
      </PublicShell>
    );
  if (error)
    return (
      <PublicShell>
        <div className="empty">
          <Flower2 size={40} />
          <h2>Vamos encontrar seu espaço.</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button>
        </div>
      </PublicShell>
    );
  const { studio, services } = data;
  return (
    <PublicShell>
      <div className="booking-layout">
        <aside className="booking-intro">
          {studio.image_url ? (
            <img
              className="studio-avatar studio-photo"
              src={studio.image_url}
              alt={studio.name}
            />
          ) : (
            <span className="avatar studio-avatar">
              {initials(studio.name)}
            </span>
          )}
          <span className="eyebrow">UM MOMENTO SÓ SEU</span>
          <h1>{studio.name}</h1>
          <p>
            {studio.bio ||
              "Escolha seu cuidado e encontre o melhor horário. Vai ser um prazer receber você."}
          </p>
          {studio.address && (
            <a
              className="location"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(studio.address)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={17} />
              {studio.address}
            </a>
          )}
          {studio.phone && (
            <a
              className="button secondary studio-contact"
              href={`https://wa.me/55${studio.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={17} /> Falar com o estúdio
            </a>
          )}
          <div className="booking-promise">
            <BrandMark size={32} />
            <p>
              Seu cuidado começa
              <br />
              antes de chegar.
            </p>
          </div>
          <div className="micro">
            <ShieldCheck size={15} /> Horários atualizados a cada consulta.
          </div>
        </aside>
        <div className="booking-main">
          {!studio.active ? (
            <div className="panel empty">
              <Clock3 size={30} />
              <h2>Uma breve pausa.</h2>
              <p>Este estúdio não está recebendo reservas online no momento.</p>
            </div>
          ) : !data.professionals?.length ? (
            <div className="panel empty"><h2>Equipe indisponível para novas reservas.</h2><p>Entre em contato com o salão para agendar.</p></div>
          ) : !services.length ? (
            <div className="panel empty">
              <Flower2 size={30} />
              <h2>Estamos preparando os cuidados.</h2>
              <p>O catálogo deste estúdio estará disponível em breve.</p>
            </div>
          ) : (
            <>
              <section className="panel booking-section">
                <label className="field">
                  <span>Quem vai atender você?</span>
                  <select value={professionalId} onChange={(e) => { setProfessionalId(e.target.value); setSelected(""); }}>
                    {data.professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <div className="numbered-title">
                  <span>01</span>
                  <h2>Quais cuidados combinam com você?</h2>
                </div>
                <p className="multi-service-hint">
                  Escolha um ou mais serviços para o mesmo atendimento. O tempo
                  e o valor serão somados.
                </p>
                <div className="booking-service-list">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setServiceIds((ids) =>
                          ids.includes(s.id)
                            ? ids.filter((id) => id !== s.id)
                            : [...ids, s.id],
                        );
                        setSelected("");
                      }}
                      className={serviceIds.includes(s.id) ? "selected" : ""}
                      aria-pressed={serviceIds.includes(s.id)}
                      disabled={
                        !serviceIds.includes(s.id) && serviceIds.length >= 20
                      }
                    >
                      {s.image_url && (
                        <img
                          className="booking-service-photo"
                          src={s.image_url}
                          alt=""
                        />
                      )}
                      <div>
                        <strong>{s.name}</strong>
                        <p>
                          <Clock3 size={13} /> {s.duration} min <span>·</span>{" "}
                          {money(s.price)}
                        </p>
                        {s.description && <small>{s.description}</small>}
                      </div>
                      <span className="select-circle">
                        {serviceIds.includes(s.id) ? (
                          <Check size={15} />
                        ) : (
                          <span>+</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                {service && (
                  <SelectionSummary
                    items={selectedServices}
                    startsAt={selected}
                  />
                )}
              </section>
              {service && (
                <section
                  className="panel booking-section"
                  ref={slotsRef}
                  tabIndex={-1}
                >
                  <div className="numbered-title">
                    <span>02</span>
                    <h2>Encontre seu melhor momento.</h2>
                  </div>
                  {submitError && <p className="note-box" role="alert">{submitError}</p>}
                  <DateSlots
                    slug={slug}
                    key={professionalId}
                    professionalId={professionalId}
                    serviceIds={serviceIds}
                    date={date}
                    setDate={setDate}
                    selected={selected}
                    setSelected={setSelected}
                    notify={notify}
                    horizon={studio.horizon}
                    refresh={refresh}
                  />
                </section>
              )}
              {service && selected && (
                <form
                  className="panel booking-section"
                  onSubmit={book}
                  ref={contactRef}
                  tabIndex={-1}
                >
                  <div className="numbered-title">
                    <span>03</span>
                    <h2>Como podemos chamar você?</h2>
                  </div>
                  <label className="field">
                    <span>Nome completo</span>
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={120}
                      autoComplete="name"
                      placeholder="Seu nome"
                    />
                  </label>
                  <label className="field">
                    <span>E-mail (opcional)</span>
                    <input
                      name="email"
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      placeholder="voce@email.com"
                    />
                  </label>
                  <label className="field">
                    <span>WhatsApp com DDD</span>
                    <input
                      name="phone"
                      type="tel"
                      required
                      maxLength={30}
                      autoComplete="tel"
                      placeholder="(11) 99999-9999"
                    />
                  </label>
                  <label className="field">
                    <span>Algum detalhe que devemos saber? (opcional)</span>
                    <textarea
                      name="notes"
                      maxLength={2000}
                      rows={2}
                      placeholder="Preferências para seu atendimento..."
                    />
                  </label>
                  <label className="honeypot" aria-hidden="true">
                    Website
                    <input name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                  {whatsappEnabled && <label className="check-field">
                    <input name="whatsapp_opt_in" type="checkbox" />
                    Autorizo {data.studio.name} a enviar confirmação, alterações e lembrete deste agendamento pelo WhatsApp. Posso cancelar enviando SAIR.
                  </label>}
                  <div className="booking-total">
                    <div>
                      <p>Com {data.professionals.find((p) => p.id === professionalId)?.name}</p>
                      <strong>{service.name}</strong>
                      <p>
                        {dateLabel(date)} · {time(selected)} até{" "}
                        {time(
                          new Date(
                            new Date(selected).getTime() +
                              service.duration * 60000,
                          ),
                        )}
                      </p>
                    </div>
                    <div>
                      <strong>{money(service.price)}</strong>
                      <p>Pagamento no local</p>
                    </div>
                  </div>
                  <p className="micro">
                    Seus dados serão usados pelo estúdio para organizar este
                    atendimento. Ao confirmar, você concorda com a regra de
                    alterações online até {changeNoticeLabel(studio)} antes
                    do atendimento.
                  </p>
                  <button className="button primary full" disabled={busy}>
                    {busy ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <Check size={17} />
                    )}{" "}
                    Confirmar agendamento
                  </button>
                  <p className="micro center">
                    A confirmação aparece aqui no site. Guarde seu link de
                    reserva.
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </div>
      {service && studio.active && professionalId && (
        <div className="booking-sticky">
          <div>
            <small>
              {serviceIds.length}{" "}
              {serviceIds.length === 1 ? "serviço" : "serviços"} ·{" "}
              {service.duration} min
            </small>
            <strong>{money(service.price)}</strong>
            <span>Pagamento no local</span>
          </div>
          <button
            className="button primary"
            onClick={() => {
              const target = selected ? contactRef.current : slotsRef.current;
              target?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
                block: "start",
              });
              target?.focus({ preventScroll: true });
            }}
          >
            {selected ? "Seus dados" : "Escolher horário"}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </PublicShell>
  );
}
export function Manage({ token, notify }) {
  const [attempt, setAttempt] = useState(0);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [date, setDate] = useState(today());
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setAction(null);
    setSelected("");
    rpc("manage_booking", { p_token: token })
      .then((data) => { if (current) { setBooking(data); if (!data) setError("Confira o link recebido para encontrar sua reserva."); } })
      .catch((e) => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, attempt]);
  async function update() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await rpc("manage_booking", {
        p_token: token,
        p_action: action,
        p_start: action === "reschedule" ? selected : null,
      });
      setBooking(data);
      setAction(null);
      notify(
        action === "cancel"
          ? "Agendamento cancelado."
          : "Novo horário confirmado.",
      );
    } catch (e) {
      notify(errorMessage(e), true);
      // Payment/status may have changed while this page was open.
      try {
        setBooking(await rpc("manage_booking", { p_token: token }));
        setAction(null);
        setSelected("");
      } catch { /* Keep the original error; a new visit retries the lookup. */ }
    } finally {
      setBusy(false);
    }
  }
  function calendar() {
    const stamp = (s) =>
      new Date(s)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const escape = (s) =>
      String(s)
        .replace(/\\/g, "\\\\")
        .replace(/\r?\n/g, "\\n")
        .replace(/[,;]/g, "\\$&");
    download(
      "meu-agendamento.ics",
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Clara//Reservas//PT-BR",
        "BEGIN:VEVENT",
        `UID:${booking.id}@encaixa`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(booking.starts_at)}`,
        `DTEND:${stamp(booking.ends_at)}`,
        `SUMMARY:${escape(booking.service + " · " + booking.studio)}`,
        `LOCATION:${escape(booking.address)}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      "text/calendar;charset=utf-8",
    );
  }
  if (loading)
    return (
      <PublicShell>
        <Spinner />
      </PublicShell>
    );
  if (error)
    return (
      <PublicShell>
        <div className="empty">
          <h2>Reserva não encontrada</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button>
        </div>
      </PublicShell>
    );
  const cancelled = booking.status === "cancelled";
  const editable = canManageBooking(booking);
  const late = changeDeadlinePassed(booking);
  const notice = changeNoticeLabel(booking);
  const whatsapp = booking.phone
    ? `https://wa.me/55${booking.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`
    : "";
  return (
    <PublicShell>
      <div className="confirmation">
        <span className={`confirmation-icon ${cancelled ? "cancelled" : ""}`}>
          {cancelled ? <X size={38} /> : <Check size={38} />}
        </span>
        <span className="eyebrow">SEU MOMENTO DE CUIDADO</span>
        <h1>
          {cancelled
            ? "Agendamento cancelado."
            : booking.status === "completed"
              ? "Cuidado concluído."
              : "Está tudo encaixado!"}
        </h1>
        <p>
          {cancelled
            ? "Esperamos ver você em outro momento."
            : `${booking.name}, seu horário está ${booking.status === "completed" ? "registrado" : "confirmado"}.`}
        </p>
        <div className="panel confirmation-card">
          <p>Profissional: {booking.professional_name}</p>
          <div className="section-head">
            <div>
              <h2>{booking.studio}</h2>
              <span
                className={`badge ${cancelled ? "cancelled" : "completed"}`}
              >
                {cancelled
                  ? "Cancelado"
                  : booking.status === "completed"
                    ? "Concluído"
                    : "Confirmado"}
              </span>
            </div>
            <Flower2 size={30} />
          </div>
          <div className="confirmation-date">
            <CalendarDays size={27} />
            <div>
              <span>
                {dateLabel(
                  new Date(booking.starts_at).toLocaleDateString("en-CA", {
                    timeZone: "America/Sao_Paulo",
                  }),
                )}
              </span>
              <strong>
                {time(booking.starts_at)}{" "}
                <small>até {time(booking.ends_at)}</small>
              </strong>
            </div>
          </div>
          <div className="confirmation-service">
            <div>
              <span className="eyebrow">SEU CUIDADO</span>
              <h3>{booking.service}</h3>
            </div>
            <strong>{money(booking.price)}</strong>
          </div>
          <ServiceBreakdown
            items={booking.service_items}
            startsAt={booking.starts_at}
          />
          <div className="note-box">
            Pagamento combinado diretamente com o estúdio.
          </div>
          {booking.address && (
            <div className="location">
              <MapPin size={18} />
              {booking.address}
            </div>
          )}
        </div>
        {!cancelled && (
          <>
            <div className="notice">
              <ShieldCheck size={21} />
              <div>
                <strong>Guarde seu link de reserva.</strong>
                <p>
                  Ele permite consultar, remarcar ou cancelar. Não compartilhe
                  esse link com outras pessoas.
                </p>
              </div>
            </div>
            <button
              className="button primary full"
              onClick={async () => {
                if (!canShareLinks) {
                  notify(sharingUnavailable);
                  return;
                }
                try {
                  await navigator.clipboard.writeText(location.href);
                  notify("Link da reserva copiado.");
                } catch {
                  notify("Copie o endereço pela barra do navegador.", true);
                }
              }}
            >
              <Copy size={17} /> Copiar meu link de reserva
            </button>
            <button className="button secondary full" onClick={calendar}>
              <CalendarDays size={17} /> Adicionar ao meu calendário
            </button>
          </>
        )}
        {whatsapp && !late && (
          <a
            className="button secondary full"
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={17} /> Falar com o estúdio
          </a>
        )}
        {booking.paid && !cancelled && (
          <div className="note-box" role="status">
            Este atendimento tem pagamento registrado. Para cancelar ou remarcar, fale com o estúdio.
          </div>
        )}
        {editable && (
          <div className="detail-actions">
            <button
              className="button secondary"
              onClick={() =>
                setAction(action === "reschedule" ? null : "reschedule")
              }
            >
              Quero remarcar
            </button>
            <button
              className="button danger"
              onClick={() => setAction(action === "cancel" ? null : "cancel")}
            >
              Quero cancelar
            </button>
          </div>
        )}
        {late && (
          <>
            <div className="note-box" role="status">
              Faltam menos de {notice} para o atendimento. Para remarcar ou
              cancelar, fale com o estúdio.
            </div>
            <div className="detail-actions">
              <button className="button secondary" disabled>
                Quero remarcar
              </button>
              <button className="button danger" disabled>
                Quero cancelar
              </button>
            </div>
            {whatsapp && (
              <a
                className="button primary full"
                href={whatsapp}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={17} /> Chamar o estúdio no WhatsApp
              </a>
            )}
          </>
        )}
        {editable && action === "cancel" && (
          <div className="panel confirm-box">
            <h3>Cancelar este momento?</h3>
            <p>
              Seu horário será liberado para outra cliente. Você pode reservar
              de novo quando quiser.
            </p>
            <button
              className="button danger full"
              disabled={busy}
              onClick={update}
            >
              {busy ? "Cancelando..." : "Sim, confirmar cancelamento"}
            </button>
            <button className="text-button" onClick={() => setAction(null)}>
              Manter meu horário
            </button>
          </div>
        )}
        {editable && action === "reschedule" && (
          <div className="panel">
            <DateSlots
              slug={booking.slug}
              professionalId={booking.professional_id}
              serviceIds={booking.service_ids || [booking.service_id]}
              token={token}
              horizon={booking.horizon}
              date={date}
              setDate={setDate}
              selected={selected}
              setSelected={setSelected}
              notify={notify}
            />
            <button
              className="button primary full"
              disabled={!selected || busy}
              onClick={update}
            >
              {busy ? "Atualizando..." : "Confirmar novo horário"}
            </button>
          </div>
        )}
        <p className="micro">
          Alterações online até {notice} antes do atendimento. Depois desse
          prazo, converse com o estúdio.
        </p>
        <a className="text-button" href={`#/booking/${booking.slug}`}>
          Fazer outro agendamento <ArrowRight size={14} />
        </a>
      </div>
    </PublicShell>
  );
}
