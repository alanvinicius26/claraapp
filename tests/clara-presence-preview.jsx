import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ClaraEmptyState, ClaraMilestone } from "../src/ClaraPresence";
import ClaraChat, { WhatsAppDraft } from "../src/ClaraChat";
import "../src/styles.css";

function Preview() {
  const [moment, setMoment] = useState(null);
  const [chat, setChat] = useState(0);
  const help = () => setChat(value => value + 1);
  return <main style={{ maxWidth: 880, padding: "32px 18px 180px", margin: "auto" }}>
    <span className="eyebrow">PRÉVIA LOCAL · DADOS FICTÍCIOS</span>
    <h1>A Clara em cada começo.</h1><p>Explore os novos momentos da personagem. Nada aqui altera os dados do seu espaço.</p>
    <ClaraEmptyState title="Vamos conhecer sua primeira cliente?" actionLabel="Ver ajuda da Clara" onAction={help} onHelp={help}>Comece pelo nome e contato. As preferências e os próximos encontros ganham seu lugar aqui.</ClaraEmptyState>
    <ClaraEmptyState title="Seu primeiro horário começa aqui" actionLabel="Ver primeira conquista" onAction={() => setMoment("first-completed")} onHelp={help}>Quando você adicionar um horário, eu te ajudo a acompanhar tudo por aqui.</ClaraEmptyState>
    <ClaraEmptyState title="Vamos dar espaço ao seu talento?" actionLabel="Ver conquista do primeiro serviço" onAction={() => setMoment("first-service")} onHelp={help}>Adicione nome, valor e duração. Eu te acompanho no primeiro passo do seu catálogo.</ClaraEmptyState>
    <section style={{ maxWidth: 380, padding: 24, border: "1px solid #e5c9ca", borderRadius: 20, background: "#fffaf7", margin: "40px auto" }}>
      <h2>Após uma remarcação</h2>
      <WhatsAppDraft draft={{ phone: "", text: "Olá, Ana! Seu atendimento foi remarcado para terça-feira, às 14h. Estamos te esperando! — Studio Exemplo" }} />
    </section>
    {moment && <ClaraMilestone kind={moment} onClose={() => setMoment(null)} />}
    <ClaraChat demo openRequest={chat} onOpenHandled={() => setChat(0)} />
  </main>;
}
createRoot(document.getElementById("root")).render(<Preview />);
