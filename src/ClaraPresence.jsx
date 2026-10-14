import React from "react";
import { ArrowRight, MessageCircle, Sparkles, X } from "lucide-react";
import ClaraArt from "./ClaraArt";
import "./clara-presence.css";

export function ClaraEmptyState({ title, children, actionLabel, onAction, onHelp, pose = "presenting" }) {
  return <section className="clara-empty">
    <div className="clara-empty-art"><ClaraArt pose={pose} loading="lazy" /></div>
    <div className="clara-empty-copy">
      <span className="clara-presence-label">UM PASSO DE CADA VEZ, COM A CLARA</span>
      <h3>{title}</h3>
      <p>{children}</p>
      <div className="clara-empty-actions">
        <button type="button" className="clara-empty-primary" onClick={onAction}>{actionLabel}<ArrowRight size={15} /></button>
        {onHelp && <button type="button" className="clara-empty-help" aria-haspopup="dialog" onClick={onHelp}><MessageCircle size={14} /> Me ajuda, Clara</button>}
      </div>
    </div>
  </section>;
}

const moments = {
  "first-service": { title: "Seu primeiro serviço está pronto!", text: "Seu talento ganhou espaço no catálogo. Esse é o começo de muitas histórias de cuidado." },
  "first-completed": { title: "Primeiro atendimento concluído!", text: "Seu cuidado fez a diferença. Que venham muitos outros encontros por aqui." },
};
export function ClaraMilestone({ kind, onClose }) {
  const moment = moments[kind];
  if (!moment) return null;
  return <aside className="clara-milestone" aria-label="Uma conquista com a Clara">
    <button className="clara-milestone-close" type="button" onClick={onClose} aria-label="Fechar comemoração"><X size={18} /></button>
    <div className="clara-milestone-art"><ClaraArt pose={kind === "first-service" ? "celebrating" : "heart"} /><Sparkles size={22} aria-hidden="true" /></div>
    <div className="clara-milestone-copy" role="status" aria-atomic="true">
      <span className="clara-presence-label">UMA CONQUISTA SUA</span>
      <h3>{moment.title}</h3><p>{moment.text}</p>
    </div>
    <button className="clara-milestone-continue" type="button" onClick={onClose}>Vamos continuar <ArrowRight size={15} /></button>
  </aside>;
}
