import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";
import { rpc } from "./lib";
import "./whatsapp.css";
import WhatsAppConnection from './WhatsAppConnection';

const simulation = import.meta.env.DEV && import.meta.env.VITE_WHATSAPP_SIMULATION === "true";
const labels = { received:"Recebida", pending:"Pendente", sending:"Processando", accepted:"Aceita pela API · entrega não confirmada", sent:"Enviada", delivered:"Entregue", read:"Lida", simulated:"Simulada · nenhum envio real", failed:"Com falha", cancelled:"Cancelada", uncertain:"Resultado incerto · não reenviada" };
const reasons = { short_notice:"Reserva feita com antecedência menor que o lembrete; confirmação suficiente.", appointment_changed:"Agendamento alterado; mensagem anterior cancelada.", expired:"Prazo de envio encerrado.", opt_out:"Cliente cancelou a autorização.", consent_missing:"Autorização ausente ou contato alterado.", template_required:"Fora da janela de atendimento. É necessário um modelo aprovado.", lease_expired:"Processamento interrompido. Confira no provedor antes de qualquer novo envio.", human_closed:"Resposta automática antiga descartada ao encerrar o atendimento." };
const date = (v) => v ? new Date(v).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo"}) : "—";

export default function WhatsApp({ studio, demo, notify }) {
  const [state,setState] = useState(null), [selected,setSelected] = useState(""), [messages,setMessages] = useState([]);
  const [error,setError] = useState(""), [busy,setBusy] = useState(false), [text,setText] = useState("");
  const [hours,setHours] = useState(24), [enabled,setEnabled] = useState(false), [template,setTemplate] = useState(false);
  const requestRef = useRef(null), current = useRef(0);
  const call = (action,data={}) => rpc("whatsapp_owner",{p_action:action,p_studio:studio.id,p_data:data});
  const refresh = async () => {
    const version = ++current.current;
    try {
      const value = await call("list");
      const id = selected || value.conversations[0]?.id || "";
      const history = id ? await call("history",{conversation_id:id}) : [];
      if (version !== current.current) return;
      setState(value); setMessages(history); setError("");
      if (!selected && id) setSelected(id);
    } catch (e) { if (version===current.current) setError(e.message); }
  };
  useEffect(() => {
    if (demo && !simulation) return;
    refresh();
    const timer=setInterval(refresh,10000);
    return () => { current.current++; clearInterval(timer); };
  },[studio.id,selected,demo]);
  useEffect(() => { if(state?.settings) {setHours(state.settings.reminder_minutes/60);setEnabled(state.settings.enabled);} },[state?.settings?.reminder_minutes,state?.settings?.enabled]);
  const conversation=state?.conversations.find(c=>c.id===selected);
  const windowOpen=conversation?.last_inbound_at && Date.now()-Date.parse(conversation.last_inbound_at)<86400000;
  const change = async (action,data={}) => {
    if(busy) return; setBusy(true);
    try { await call(action,data); await refresh(); }
    catch(e) { notify(e.message,true); }
    finally {setBusy(false);}
  };
  const simulate = async (action,data={}) => {
    setBusy(true);
    try {
      const res=await fetch(`/whatsapp-sim/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      if(!res.ok) throw new Error("Não foi possível executar a simulação.");
      await refresh();
    } catch(e) {notify(e.message,true);} finally {setBusy(false);}
  };
  if (demo && !simulation) return <section className="panel"><h1>Conversas WhatsApp</h1><p>Para testar o atendimento completo com dados fictícios, inicie o simulador local conforme WHATSAPP-N8N.md.</p><p>Nenhuma mensagem será enviada pela demonstração comum.</p></section>;
  return <>
    <div className="page-title"><div><span className="eyebrow">ATENDIMENTO</span><h1>Conversas WhatsApp</h1><p>Solicitações de atendimento e histórico de mensagens do seu estabelecimento.</p></div><button className="button secondary" onClick={refresh}><RefreshCw size={16}/> Atualizar</button></div>
    <div className="notice"><MessageCircle size={20}/><span>{simulation || state?.settings?.mode!=="live" ? "SIMULAÇÃO: mensagens não são enviadas ao WhatsApp real." : "Canal oficial: entrega confirmada somente pelo retorno da Meta."}</span></div>
    {error && <div className="notice" role="alert">Não foi possível carregar as conversas. {error} <button className="text-button" onClick={refresh}>Tentar novamente</button></div>}
    {simulation && <section className="panel wa-simulation"><h2>Testar atendimento</h2><p>Cliente fictícia (11) 90000-0101. Os botões geram mensagens recebidas; processe a fila para ver as respostas.</p><div className="button-row">
      {[['Olá','Iniciar conversa'],['Agendar','Escolher Agendar'],['Falar com atendente','Pedir atendente'],['SAIR','Revogar autorização']].map(([value,label])=><button key={value} className="button secondary" disabled={busy} onClick={()=>simulate('inbound',{text:value})}>{label}</button>)}
      <button className="button primary" disabled={busy} onClick={()=>simulate('process')}>Processar fila simulada</button>
      <button className="button secondary" disabled={busy} onClick={()=>simulate('reminders')}>Antecipar lembretes na simulação</button>
      <a className="button secondary" href="#/booking/clara-simulacao" target="_blank" rel="noreferrer">Abrir link de agendamento fictício</a>
    </div></section>}
    <WhatsAppConnection studioId={studio.id} notify={notify} onChange={refresh}/>
    <details className="panel wa-settings"><summary>Configuração de notificações</summary><form onSubmit={e=>{e.preventDefault();change('settings',{enabled,reminder_minutes:Math.round(Number(hours)*60)});}}>
      <label className="check-field"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Ativar processamento deste estabelecimento</label>
      <label className="field"><span>Antecedência do lembrete (horas)</span><input type="number" min={1/12} max={168} step="any" value={hours} onChange={e=>setHours(e.target.value)} required/></label>
      <p className="micro">Fuso: America/Sao_Paulo. Reservas feitas com menos antecedência recebem somente a confirmação. Notificações exigem autorização da cliente. A ativação não muda o modo de simulação.</p>
      <button className="button primary" disabled={busy}>Salvar configuração</button>
    </form></details>
    <div className="wa-layout"><section className="panel wa-conversations"><h2>Conversas</h2><p>{state?.conversations.filter(c=>c.mode==='human').length || 0} solicitações em atendimento humano</p>
      {!state?.conversations.length && <p className="muted">As conversas recebidas aparecerão aqui.</p>}
      {state?.conversations.map(c=><button key={c.id} className={`wa-conversation ${c.id===selected?'selected':''}`} onClick={()=>{setSelected(c.id);setText('');setTemplate(false);requestRef.current=null;}}><strong>+{c.phone}</strong><span>{c.mode==='human'?'Atendimento humano · bot pausado':'Atendimento automático'}</span><small>Última mensagem: {date(c.last_inbound_at)}</small>{c.opted_out && <small>Notificações revogadas</small>}</button>)}
      <p className="micro">Até 200 conversas mais recentes.</p>
    </section><section className="panel wa-thread">
      {conversation ? <><div className="section-head"><div><h2>+{conversation.phone}</h2><p>{conversation.mode==='human'?'Bot pausado até encerrar atendimento.':'Bot ativo para novas mensagens.'}</p><p className="micro">{windowOpen?'Janela de atendimento aberta.':'Janela de atendimento encerrada: somente modelo aprovado.'}</p></div><button className="button secondary" disabled={busy} onClick={()=>change(conversation.mode==='human'?'close':'take',{conversation_id:selected})}><UserRound size={16}/>{conversation.mode==='human'?'Encerrar atendimento':'Assumir atendimento'}</button></div>
        <div className="wa-history" aria-label="Histórico de mensagens">{messages.map(m=><article key={m.id} className={`wa-message ${m.direction==='in'?'incoming':'outgoing'}`}><div><strong>{m.direction==='in'?'Cliente':m.kind==='manual'?'Atendente':'Clara'}</strong><small>{date(m.created_at)}</small></div><p>{m.body || (m.kind==='reminder'?'Lembrete agendado; dados conferidos antes do envio.':'Notificação preparada; dados conferidos antes do envio.')}</p><span className={`wa-status ${m.status}`}>{labels[m.status]}{m.mode==='simulation' && m.status!=='simulated'?' · simulação':''}</span>{m.status==='pending' && <small>Programada: {date(m.available_at)}{conversation.mode==='human' && m.kind!=='manual'?' · aguardando encerramento do atendimento':''}</small>}{m.error_code && <small>{reasons[m.error_code] || `Motivo: ${m.error_code}`}</small>}</article>)}</div>
        <p className="micro">Últimas 200 mensagens. “Aceita pela API” não confirma envio ou entrega.</p>
        <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);const signature=JSON.stringify([selected,text,template]);if(requestRef.current?.signature!==signature)requestRef.current={signature,id:crypto.randomUUID()};try{await call('send',{conversation_id:selected,body:text,request_id:requestRef.current.id,template_key:template?'human_followup':null});setText('');requestRef.current=null;await refresh();}catch(err){notify(err.message,true);}finally{setBusy(false);}}}>
          <label className="field"><span>Resposta manual</span><textarea maxLength={4000} rows={3} required value={text} onChange={e=>setText(e.target.value)} placeholder="Sua resposta para a cliente"/></label>
          {!windowOpen && <label className="check-field"><input type="checkbox" checked={template} disabled={!state.settings?.templates?.human_followup?.approved} onChange={e=>{setTemplate(e.target.checked);if(e.target.checked)setText('Podemos continuar seu atendimento? Responda a esta mensagem para falar com nossa equipe.');}}/>Usar modelo aprovado de retomada (requer autorização)</label>}
          <p className="micro">Enviar uma resposta assume o atendimento e pausa o bot. Fora das 24 horas, não é permitido enviar texto livre.</p>
          <button className="button primary" disabled={busy || !text.trim() || (!windowOpen && !template)}><Send size={16}/> Preparar envio manual</button>
        </form>
      </>:<div className="wa-empty"><MessageCircle size={32}/><p>Selecione uma conversa para acompanhar o atendimento.</p></div>}
    </section></div>
  </>;
}
