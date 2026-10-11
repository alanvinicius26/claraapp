import { slotTime } from "../supabase/functions/clara/reschedule.js";
import { whatsappLink } from "./clara-whatsapp";
import React, { useEffect, useRef, useState } from "react";
import { X, Send, LoaderCircle } from "lucide-react";
import claraPortrait from "./assets/clara-personagem-v1.webp";
import claraPresenting from "./assets/clara-apontando-v1.webp";
import { supabase, query } from "./lib";
import "./clara.css";
const greeting={role:"assistant",text:"Sou a Clara, sua assistente ✨\nComo posso deixar seu dia mais leve?"};
const suggestions=["Qual é meu próximo atendimento?","Quanto recebi nesta semana?","Quem está agendada para amanhã?"];
export default function ClaraChat({demo=false,notice,onRescheduled,userId,openRequest=0,onOpenHandled}) {
 const [open,setOpen]=useState(false),[messages,setMessages]=useState([greeting]),[input,setInput]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[starting,setStarting]=useState(false);
 useEffect(()=>{if(notice){setMessages(m=>[...m,{role:"assistant",text:"Horário atualizado! Preparei esta mensagem para você revisar e enviar:",whatsapp:notice}]);setOpen(true);}},[notice]);
 const [dialogue,setDialogue]=useState(null),[retry,setRetry]=useState(null);
 const initialized=useRef(false),revision=useRef(null),generation=useRef(0),resetQueue=useRef(Promise.resolve());
 const field=useRef(null),launcher=useRef(null),end=useRef(null),panel=useRef(null),controller=useRef(null),inFlight=useRef(false);
 const opener=useRef(null);
 useEffect(()=>{if(openRequest){opener.current=document.activeElement;setOpen(true);onOpenHandled?.();}},[openRequest]);
 useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
 useEffect(()=>{if(open&&!demo&&!initialized.current){initialized.current=true;startConversation();}},[open,demo]);
 useEffect(()=>{if(open) field.current?.focus();},[open,busy]);
 useEffect(()=>{if(open) end.current?.scrollIntoView({block:"nearest"});},[messages,busy,open,error]);
 function queueReset(){
  const job=resetQueue.current.catch(()=>{}).then(async()=>{
   const {session}=await query(supabase.auth.getSession());
   if(!session||(userId&&session.user?.id!==userId))throw new Error('Sua sessão expirou. Entre novamente.');
   for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/clara',{
     method:'POST',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},
     body:JSON.stringify({action:{kind:'reset'}}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();
    if(response.status===409&&attempt<2)continue;
    if(!response.ok||body.dialogue?.stage!=='idle')throw new Error(body.message||'Não consegui iniciar uma nova conversa. Tente novamente.');
    return body;
   }
  });
  resetQueue.current=job;job.catch(()=>{});return job;
 }
 async function startConversation(){
  const active=generation.current;
  inFlight.current=true;setBusy(true);setStarting(true);setError('');setRetry(null);
  try{
   const body=await queueReset();
   if(active!==generation.current)return;
   revision.current=body.dialogue.revision;setDialogue(body.dialogue);
  }catch{
   if(active!==generation.current)return;
   setError('Não consegui preparar uma nova conversa. Tente novamente.');setRetry({text:'',action:{kind:'reset'}});
  }finally{
   if(active===generation.current){inFlight.current=false;setBusy(false);setStarting(false);field.current?.focus();}
  }
 }
 function close(){
  generation.current++;controller.current?.abort();inFlight.current=false;initialized.current=false;revision.current=null;
  setOpen(false);setMessages([greeting]);setInput('');setError('');setRetry(null);setDialogue(null);setBusy(false);setStarting(false);
  if(!demo)queueReset();
  (opener.current?.isConnected?opener.current:launcher.current)?.focus();
 }
 function keys(e){
  if(e.key==="Escape"){e.preventDefault();close();}
  if(e.key==="Tab"){
   const nodes=[...panel.current.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]")];
   const first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }
 async function send(text=input,action=null){
  text=text.trim();if((!text&&!action)||inFlight.current)return;
  if(action?.kind==='reset')return startConversation();

  if(demo){setMessages(m=>[...m,{role:"user",text},{role:"assistant",text:"Esta é uma prévia do chat. Entre na sua conta para consultar os dados reais do seu salão."}]);setInput("");return;}
  if(revision.current===null)return startConversation();
  const active=generation.current,requestRevision=revision.current;
  inFlight.current=true;setBusy(true);setError("");setRetry(null);setInput("");
  const history=messages.filter(m=>m.role==="user"&&!m.localAction).slice(-4).map(m=>m.text);
  if(text)setMessages(m=>[...m,{role:"user",text,localAction:!!action}]);
  const abort=new AbortController();controller.current=abort;
  const timeout=setTimeout(()=>abort.abort(),45000);
  try{
   const {session}=await query(supabase.auth.getSession());
   if(active!==generation.current)return;
   if(!session) throw new Error("Sua sessão expirou. Entre novamente.");
   const response=await fetch(import.meta.env.VITE_SUPABASE_URL+"/functions/v1/clara",{
    method:"POST",headers:{"Content-Type":"application/json",apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({message:text,history,revision:requestRevision,action}),signal:abort.signal});
   const body=await response.json();
   if(body.rescheduled)onRescheduled?.();
   if(active!==generation.current)return;
   if(body.dialogue){revision.current=body.dialogue.revision;setDialogue(body.dialogue);}
   if(!response.ok&&body.dialogue)setMessages(m=>[...m,{role:'assistant',text:body.answer,reschedule:body.reschedule,confirmation:body.confirmation,revision:body.dialogue.revision}]);
   if(!response.ok)throw new Error(body.message||"A Clara está indisponível. Tente novamente.");
   if(typeof body.answer!=="string")throw new Error("Não consegui ler a resposta. Tente novamente.");
   if(action?.kind!=='resume'||body.dialogue?.stage!=='idle')setMessages(m=>[...m,{role:"assistant",text:body.answer,actions:body.actions,reschedule:body.reschedule,confirmation:body.confirmation,whatsapp:body.whatsapp,revision:body.dialogue?.revision}]);

  }catch(err){
   if(active!==generation.current)return;
   setError(abort.signal.aborted?(action?.kind==='confirm'?"A confirmação demorou. Tente confirmar novamente para verificar o resultado com segurança.":"A consulta demorou. Tente novamente."):err.message);
   if(action)setRetry({text,action});else setInput(text);
  }
  finally{clearTimeout(timeout);if(active===generation.current){inFlight.current=false;setBusy(false);field.current?.focus();}}
 }
 return <>
  <button ref={launcher} className="clara-launcher" title="Pergunte à Clara" aria-label={open?"Fechar chat da Clara":"Pergunte à Clara"} aria-expanded={open} aria-controls="clara-chat" onClick={()=>{if(open)close();else{opener.current=launcher.current;setOpen(true);}}}><span className="clara-portrait"><img src={claraPortrait} alt="" /></span><span className="clara-help-badge" aria-hidden="true">?</span></button>
  {open&&<div className="clara-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
   <section id="clara-chat" ref={panel} className="clara-panel" role="dialog" aria-modal="true" aria-labelledby="clara-title" onKeyDown={keys}>
    <header className="clara-header"><span className="clara-avatar clara-portrait"><img src={claraPortrait} alt="" /></span><div><h2 id="clara-title">Clara</h2><p>Sua assistente · Clara</p></div><button type="button" aria-label="Fechar chat" onClick={close}><X size={21}/></button></header>
    <div className="clara-messages" role="log" aria-live="polite" aria-relevant="additions text">
     {messages.map((m,i)=><div key={i} className={"clara-message "+m.role}>{m.text}
      {m.actions?.map(a=><button className="clara-action" key={a.id} disabled={busy} onClick={()=>send(a.label.replace('Ver / remarcar:','Remarcar:'),{kind:'select',appointmentId:a.id})}>{a.label.replace('Ver / remarcar:','Remarcar:')}</button>)}
      {m.reschedule?.ticket&&<div className="clara-slots">{m.reschedule.slots.map(start=><button key={start} className="clara-action" disabled={busy||m.revision!==dialogue?.revision} onClick={()=>send('Escolher '+slotTime(start),{kind:'propose',ticket:m.reschedule.ticket,start})}>{slotTime(start)}</button>)}
       {m.revision===dialogue?.revision&&<button className="clara-action" disabled={busy} onClick={()=>send('Manter horário atual',{kind:'abandon'})}>Manter horário atual</button>}
      </div>}
      {m.confirmation&&<div className="clara-confirmation"><button className="clara-action" disabled={busy||m.revision!==dialogue?.revision} onClick={()=>send('Confirmar remarcação',{kind:'confirm',ticket:m.confirmation.ticket,start:m.confirmation.start,revision:m.revision})}>Confirmar remarcação</button><button className="clara-action" disabled={busy||m.revision!==dialogue?.revision} onClick={()=>send('Escolher outro horário',{kind:'back'})}>Escolher outro horário</button></div>}
      {m.whatsapp&&<WhatsAppDraft draft={m.whatsapp}/>}</div>)}

     {messages.length===1&&<div className="clara-suggestions">{suggestions.map(s=><button key={s} onClick={()=>send(s)} disabled={busy||(!demo&&!dialogue)}>{s}<span aria-hidden="true">↗</span></button>)}</div>}
     {busy&&<div className="clara-thinking"><LoaderCircle size={15}/> {starting?'Preparando uma nova conversa…':'Consultando seu salão…'}</div>}
     {error&&<p className="clara-error" role="alert">{error}{retry&&<button className="clara-action" disabled={busy} onClick={()=>send(retry.text,retry.action)}>Tentar novamente</button>}</p>}<div ref={end}/>
    </div>
    <form className="clara-form" onSubmit={e=>{e.preventDefault();send();}}>
     <label className="clara-label" htmlFor="clara-input">Pergunte sobre clientes, agenda ou como usar o app</label>
     <div className="clara-compose"><input ref={field} id="clara-input" maxLength={1000} value={input} onChange={e=>setInput(e.target.value)} placeholder="O que você quer saber?" autoComplete="off"/><button type="submit" disabled={busy||!input.trim()||(!demo&&!dialogue)} aria-label="Enviar pergunta"><Send size={18}/></button></div>
     <small>{demo?"Prévia · sem consultas a dados reais":"Ajuda, consultas e remarcações · Sua pergunta é processada por IA."}</small>
    </form>
   </section>
  </div>}
 </>;
}


export function WhatsAppDraft({draft}) {
 const [text,setText]=useState(draft.text),[copied,setCopied]=useState(false);
 const link=whatsappLink(draft.phone,text);
 return <div className="clara-whatsapp"><div className="clara-draft-intro"><img src={claraPresenting} alt="" width="1536" height="1024" decoding="async" /><strong>Prontinho!<br/>Vamos avisar sua cliente?</strong></div><label>Mensagem para o cliente<textarea value={text} onChange={e=>setText(e.target.value)} rows={7}/></label>
 {link&&text.trim()?<a className="clara-action" href={link} target="_blank" rel="noopener noreferrer">Enviar</a>:<small>Cadastre um telefone brasileiro com DDD para abrir a conversa. Você pode copiar a mensagem.</small>}
 <button className="clara-action" onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setCopied(false);}}}>{copied?"Mensagem copiada":"Copiar mensagem"}</button><small>Revise o texto e toque em enviar no WhatsApp.</small></div>;
}
