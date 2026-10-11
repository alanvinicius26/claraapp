import React, { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, MessageCircle, RefreshCw } from "lucide-react";
import clara from "./assets/clara-apontando-v1.webp";
import { claraDaySummary } from "./clara-day";
import "./clara-day.css";

export default function ClaraDayCard({ appointments, day, professionalId, professionalName, name, unavailable, onRefresh, onNext, onChat }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  const summary = claraDaySummary(appointments, { day, professionalId, now });
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return <section className="clara-day" aria-labelledby="clara-day-title">
    <img className="clara-day-character" src={clara} alt="" width="1536" height="1024" decoding="async" />
    <div className="clara-day-copy">
      <span className="clara-day-eyebrow"><span /> SEU DIA COM A CLARA</span>
      <h2 id="clara-day-title">{summary.greeting}{firstName ? `, ${firstName}` : ""}<span>.</span></h2>
      <p className="clara-day-summary">{unavailable ? "Não consegui atualizar sua agenda agora." : summary.summary}</p>
      <p className="clara-day-note">{unavailable ? "Vamos tentar novamente para conferir seus horários?" : summary.count ? "Um cuidado de cada vez. Vamos organizar seu dia?" : "Que tal abrir espaço para o próximo encontro?"}</p>
      {professionalId && <span className="clara-day-scope">Agenda de {professionalName || "profissional selecionada"}</span>}
    </div>
    <div className="clara-day-next">
      <span className="clara-day-next-label"><CalendarDays size={14} /> PRÓXIMO ENCONTRO</span>
      {!unavailable && summary.next ? <>
        <strong>{summary.next.clients?.name || "Cliente do atendimento"}</strong>
        <span>{summary.nextLabel}</span>
      </> : <>
        <strong>{unavailable ? "Vamos conferir?" : "Seu próximo encontro vem aí"}</strong>
        <span>{unavailable ? "Atualize a agenda para continuar." : "Nenhum próximo horário confirmado."}</span>
      </>}
    </div>
    <div className="clara-day-actions">
      {unavailable ? <button type="button" className="clara-day-primary" onClick={onRefresh}><RefreshCw size={16} /> Atualizar agenda</button> : summary.next && <button type="button" className="clara-day-primary" onClick={() => onNext(summary.next, summary.nextDay)}>Ver próximo atendimento <ArrowUpRight size={16} /></button>}
      <button type="button" className="clara-day-chat" aria-haspopup="dialog" aria-controls="clara-chat" onClick={onChat}><MessageCircle size={16} /> Perguntar à Clara</button>
      {!unavailable && summary.completed > 0 && <span className="clara-day-progress">{summary.completed} de {summary.count} concluído{summary.completed === 1 ? "" : "s"}</span>}
    </div>
  </section>;
}
