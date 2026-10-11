const when=v=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full',timeStyle:'short'}).format(new Date(v));
export const slotTime=v=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
export function relativeDay(text,today) {
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const base=new Date(today+'T12:00:00Z');
 if(/\b(depois de amanha|amanha|hoje)\b/.test(t)){
  base.setUTCDate(base.getUTCDate()+(/depois de amanha/.test(t)?2:/amanha/.test(t)?1:0));
 }else{
  const days=['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
  const day=days.findIndex(d=>new RegExp('\\b'+d+'(?:-feira)?\\b').test(t));
  if(day<0)return null;
  let delta=(day-base.getUTCDay()+7)%7;
  if(/semana que vem|proxima semana/.test(t))delta=7-(base.getUTCDay()+6)%7+(day+6)%7;
  else if(delta===0)delta=7;
  base.setUTCDate(base.getUTCDate()+delta);
 }
 return base.toISOString().slice(0,10);
}
export function optionsReply(options){
 const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full'}).format(new Date(options.date+'T12:00:00Z'));
 return {answer:`${options.client||'Cliente'} · ${options.service}\nProfissional: ${options.professional}\nHorário atual: ${when(options.oldStart)}.\n\n`+(options.slots.length?`Horários disponíveis para ${date}:\nEscolha abaixo para confirmar a remarcação. As opções valem por 15 minutos.`:`Não há horários disponíveis para ${date} com essa profissional. Me diga outra data.`),reschedule:options,context:{appointmentId:options.appointmentId,awaitingDate:true}};
}
export function confirmationReply(data){
 const text=`Olá, ${data.client||'tudo bem'}! Seu atendimento de ${data.service} no ${data.studio} foi remarcado.\n\nAntes: ${when(data.oldStart)}.\nNovo horário: ${when(data.startsAt)}.\nProfissional: ${data.professional}.\n\nEsperamos você! Se precisar de algo, fale com a gente.`;
 return {answer:`Pronto! Remarquei o atendimento de ${data.client||'seu cliente'} para ${when(data.startsAt)}.\n\nPreparei a mensagem abaixo:`,whatsapp:{phone:data.phone,text},context:{appointmentId:data.appointmentId},rescheduled:true};
}
export function selectedSlot(text,options){
 const match=text.trim().match(/^(?:(?:as|às|quero|pode ser|remarque para|confirmo)\s+)?(\d{1,2})(?::(\d{2})|h(\d{2})?)\s*(?:horas)?[.!]?$/i);
 if(!match)return null;
 const target=match[1].padStart(2,'0')+':'+(match[2]||match[3]||'00');
 return options?.slots?.find(s=>slotTime(s)===target)||null;
}
