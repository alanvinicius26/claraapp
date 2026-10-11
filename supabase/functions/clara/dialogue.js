import {interpret,filterSlots,timeMatches,minutes,normalize} from './language.js';
import {optionsReply,confirmationReply} from './reschedule.js';
const when=s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full',timeStyle:'short'}).format(new Date(s));
const id=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
export function dialogueView(dialogue,answer){
 const s=dialogue.state;
 if(s.stage==='identified'&&s.receipt)return {...confirmationReply(s.receipt),dialogue:{revision:dialogue.revision,stage:s.stage}};
 const result={answer:answer||'Para qual dia você quer remarcar?',dialogue:{revision:dialogue.revision,stage:s.stage}};
 if(s.stage==='offer'&&s.options){
  const options={...s.options,slots:s.visibleSlots||[]};
  result.answer=answer||optionsReply(options).answer.replace('Escolha abaixo para confirmar a remarcação.','Escolha um horário para conferir os detalhes antes de salvar.');
  result.reschedule=options;
 }
 if(s.stage==='confirm'&&s.pendingStart){
  const label=`${s.options.client||'Cliente'} · ${s.options.service}\nCom ${s.options.professional}\nDe ${when(s.options.oldStart)}\nPara ${when(s.pendingStart)}`;
  result.answer=answer||`Esse horário está disponível.\n\n${label}\n\nPosso confirmar essa remarcação?`;
  result.confirmation={ticket:s.ticket,start:s.pendingStart,label};
 }
 if(s.stage==='cancel_question')result.answer=answer||'Você quer desistir desta remarcação ou cancelar o atendimento? Para manter a reserva original, diga “deixa como está”. Para cancelar o atendimento, use os detalhes na agenda.';
 if(s.stage==='identified'&&!answer)result.answer='O atendimento continua identificado. Para qual data você quer remarcar?';
 if(s.stage==='idle'&&!answer)result.answer='Sou a Clara, sua assistente ✨\nComo posso deixar seu dia mais leve?';
 return result;
}

// All operations go through the authenticated, revision-checked database API.
export async function handleDialogue({text='',action,dialogue,today,rpc,semantic}){
 let current=dialogue,s=current.state;
 const save=async(state,answer)=>{current=await rpc('clara_dialogue_save',{p_revision:current.revision,p_state:state});s=current.state;return dialogueView(current,answer);};
 const commit=async(ticket,start,revision)=>{
  const d=await rpc('clara_dialogue_commit',{p_revision:revision,p_ticket:ticket,p_start:start});
  return {...confirmationReply(d.result),dialogue:{revision:d.revision,stage:d.state.stage}};
 };
 if(action?.kind==='resume')return dialogueView(current);
 if(action?.kind==='reset')return save({stage:'idle'});
 if(action?.kind==='confirm')return commit(action.ticket,action.start,action.revision);
 if(action?.kind==='select'){
  if(!id(action.appointmentId))throw new Error('Selecione um atendimento da agenda.');
  return save({stage:'date',appointmentId:action.appointmentId},'Atendimento selecionado. Para qual dia você quer remarcar?');
 }
 if(action?.kind==='abandon')return save({stage:'idle'},'Tudo bem, encerrei a tentativa de remarcação. O atendimento foi mantido.');
 if(action?.kind==='back')return save({...s,stage:s.options?'offer':'date',pendingStart:null});
 if(action?.kind==='propose'){
  if(s.stage!=='offer'||s.ticket!==action.ticket||!s.visibleSlots?.includes(action.start))throw new Error('Essa opção não está mais ativa. Confira os horários atuais.');
  return save({...s,stage:'confirm',pendingStart:action.start});
 }
 if(action)throw new Error('Atualize o chat e escolha uma opção atual.');
 if(/\b(recebi|faturei|recebimentos|lucro|tutorial|como|ajuda|cadastrar)\b/.test(normalize(text)))return null;
 if(/\bproximo (?:atendimento|agendamento)\b/.test(normalize(text))&&!/remarc|reagend|mudar|trocar/.test(normalize(text)))return null;
 let intent=interpret(text,today,s);
 if(s.stage==='idle')return null;
 if(intent.type==='unknown'&&semantic){
  // The model extracts phrases from the user's own message only. It cannot confirm.
  const parsed=await semantic(text,s.stage);
  const allowed=['date','time','period','ordinal','start','change_target','clarify_date','clarify_time','cancel_question'];
  if(allowed.includes(parsed?.type)&&typeof parsed.phrase==='string'&&parsed.phrase&&normalize(text).includes(normalize(parsed.phrase))){
   // Canonicalization handles colloquial language/typos, but only produces a preview.
   // A model-supplied affirmation is never an executable intent.
   const canonical=typeof parsed.canonical==='string'&&parsed.canonical.length<=120&&!/\bnao\b/.test(normalize(text))?parsed.canonical:parsed.phrase;
   const extracted=interpret(canonical,today,s);
   if(extracted.type===parsed.type)intent=extracted;
  }
 }
 if(intent.type==='unknown')return null;
 if(intent.type==='abandon')return save({stage:'idle'},'Tudo bem, mantive o atendimento no horário original.');
 if(intent.type==='cancel_question')return save({...s,stage:'cancel_question',pendingStart:null},null);
 if(intent.type==='change_target')return save({stage:'idle'},'Vamos identificar o atendimento e a profissional corretamente. Consulte a agenda ou o cliente pelo nome e selecione o atendimento desejado. Para trocar a profissional, use os detalhes na agenda.');
 if(intent.type==='affirm'){
  if(s.stage==='confirm'&&s.pendingStart)return commit(s.ticket,s.pendingStart,current.revision);
  return save({...s,stage:s.options?'offer':'date',pendingStart:null},'Qual data ou horário você escolheu? Ainda não há uma proposta específica para confirmar.');
 }
 if(intent.type==='reject')return save({...s,stage:s.options?'offer':'date',pendingStart:null},'Sem problema. Me diga outra data ou escolha outro horário.');
 if(intent.type==='clarify_date')return save({stage:'date',appointmentId:s.appointmentId},'Qual é a data exata que você prefere? Pode informar o dia e o mês, por exemplo “15/10”.');
 if(intent.type==='clarify_time')return save({...s,stage:s.options?'offer':'date',pendingStart:null},'Qual horário ou período você prefere? Pode dizer “depois das 14h” ou “pela manhã”.');
 if(intent.type==='start')return save({stage:'date',appointmentId:s.appointmentId},'Para qual dia você quer remarcar esse atendimento?');

 async function loadDate(date,prefs={}){
  // First revoke the previous proposal. A failed new search must not resurrect it.
  await save({stage:'date',appointmentId:s.appointmentId,date,prefs});
  const options=await rpc('clara_reschedule_options',{p_appointment:s.appointmentId,p_date:date});
  const visibleSlots=filterSlots(options.slots,prefs);
  return save({stage:'offer',appointmentId:s.appointmentId,date,prefs,options,ticket:options.ticket,visibleSlots,pendingStart:null},
   options.slots.length&&!visibleSlots.length?'Não encontrei horários nesse período. Me diga outro período ou outra data.':undefined);
 }
 if(intent.type==='date'){
  if(intent.date<today)return save({stage:'date',appointmentId:s.appointmentId},'Essa data já passou. Qual data futura você prefere?');
  const prefs=intent.period?{period:intent.period}:{};
  if((intent.after||intent.before)&&intent.time){
   if(intent.time.ambiguous)return save({stage:'date',appointmentId:s.appointmentId,date:intent.date},'Você prefere antes ou depois de qual horário? Informe no formato 24 horas, por exemplo “depois das 14h”.');
   prefs[intent.after?'after':'before']=intent.time.hour*60+intent.time.minute;
  }
  const result=await loadDate(intent.date,prefs);
  if(intent.sameTime){const matches=s.visibleSlots.filter(v=>minutes(v)===minutes(s.options.oldStart));if(matches.length===1)return save({...s,stage:'confirm',pendingStart:matches[0]});return dialogueView(current,'O horário original não está disponível nesse dia. Escolha uma das opções abaixo.');}
  if(intent.time&&!intent.after&&!intent.before){const matches=timeMatches(s.visibleSlots,intent.time);if(matches.length===1)return save({...s,stage:'confirm',pendingStart:matches[0]});}
  return result;
 }
 if(!s.options){
  if(s.date&&['period','filter_time'].includes(intent.type)){
   if(intent.type==='period')return loadDate(s.date,{period:intent.period});
   if(!intent.time.ambiguous)return loadDate(s.date,{[intent.after?'after':'before']:intent.time.hour*60+intent.time.minute});
  }
  return save({...s,stage:'date',pendingStart:null},'Para qual dia? Assim consigo consultar os horários disponíveis.');
 }
 if(Date.parse(s.options.expiresAt)<=Date.now())return loadDate(s.date,s.prefs);
 if(['period','filter_time','relative_time'].includes(intent.type)){
  const prefs={};
  if(intent.type==='period')prefs.period=intent.period;
  if(intent.type==='filter_time'){
   if(intent.time.ambiguous)return save({...s,stage:'offer',pendingStart:null},'Você se refere a qual horário? Informe no formato 24 horas, como “depois das 14h”.');
   prefs[intent.after?'after':'before']=intent.time.hour*60+intent.time.minute;
  }
  if(intent.type==='relative_time'){
   if(!s.pendingStart)return save({...s,stage:'offer',pendingStart:null},'Mais cedo ou mais tarde do que qual horário?');
   prefs[intent.direction==='earlier'?'before':'after']=minutes(s.pendingStart);
  }
  return loadDate(s.date,prefs);
 }
 let matches=[];
 if(intent.type==='ordinal'){
  const choice=intent.index===-1?s.visibleSlots.at(-1):s.visibleSlots[intent.index];if(choice)matches=[choice];
 }
 if(intent.type==='same_time')matches=s.visibleSlots.filter(v=>minutes(v)===minutes(s.options.oldStart));
 if(intent.type==='time')matches=timeMatches(s.visibleSlots,intent.time);
 if(matches.length===1)return save({...s,stage:'confirm',pendingStart:matches[0]});
 return save({...s,stage:'offer',pendingStart:null},matches.length>1?'Há mais de uma interpretação possível. Escolha o horário completo nas opções abaixo.':'Esse horário não está entre as opções atuais. Escolha uma opção disponível ou peça outro dia/período.');
}
