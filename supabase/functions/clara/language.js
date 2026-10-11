// Interpret language without performing actions. Ambiguity always remains explicit.
export const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const iso=d=>d.toISOString().slice(0,10);
const dayNames=['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
const dayRe=/\b(domingo|dom|segunda(?:-feira)?|seg|terca(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sab)\b/g;
const dayIndex=w=>dayNames.findIndex(n=>n.slice(0,3)===w.slice(0,3));
const validDate=(y,m,d)=>{
 const date=new Date(Date.UTC(y,m-1,d,12));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?iso(date):null;
};
export function parseDate(text,today) {
 const t=normalize(text),base=new Date(today+'T12:00:00Z');
 if(/\b(feriado|dia util|fim de semana|final de semana|qualquer dia)\b/.test(t))return {ambiguous:true};
 if(/\b(passad[ao]|ontem|anteontem|toda|todas|todo|todos)\b/.test(t))return {ambiguous:true};
 if(/\bou\s+(?:dia\s+)?\d/.test(t))return {ambiguous:true};
 if([...t.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)].length>1)return {ambiguous:true};
 const week= /semana que vem|proxima semana/.test(t);
 const days=[...t.matchAll(dayRe)].filter(m=>!/^\s+(opcao|horario|alternativa)\b/.test(t.slice(m.index+m[0].length))&&(m[0]!=='ter'||m.index===0||/\b(na|para|proxima)\s+$/.test(t.slice(0,m.index))));
 if(days.length){
  if(days.length>1&&!/\b(nao|melhor|quis dizer|quer dizer|corrigindo|troca|alias)\b/.test(t))return {ambiguous:true};
  let last=days.at(-1);
  if(days.length>1){
   const middle=t.slice(days[0].index+days[0][0].length,days.at(-1).index);
   if(!/^\s+nao[,;]?\s*$/.test(middle)&&!/melhor|quis dizer|quer dizer|corrigindo|alias/.test(middle)){
    const positive=days.filter(m=>!(/\bnao\s+(?:na |no |para )?$/.test(t.slice(0,m.index))));
    if(positive.length!==1)return {ambiguous:true};last=positive[0];
   }
  }
  if(days.length===1&&/\bnao\s+(?:na |no |para |nessa |nesta )?$/.test(t.slice(0,last.index)))return {ambiguous:true};
  if(days.length===1&&/^\s+nao\b/.test(t.slice(last.index+last[0].length)))return {ambiguous:true};
  const dow=dayIndex(last[0]);let delta=(dow-base.getUTCDay()+7)%7;
  if(week)delta=7-(base.getUTCDay()+6)%7+(dow+6)%7;
  else if(delta===0&&/proxim|que vem|seguinte/.test(t))delta=7;
  base.setUTCDate(base.getUTCDate()+delta);return {date:iso(base)};
 }
 if(/\b(depois de amanha|amanha|hoje)\b/.test(t)){
  base.setUTCDate(base.getUTCDate()+(/depois de amanha/.test(t)?2:/amanha/.test(t)?1:0));return {date:iso(base)};
 }
 let m=t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
 if(m)return {date:validDate(+m[1],+m[2],+m[3]),ambiguous:!validDate(+m[1],+m[2],+m[3])};
 m=t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/);
 if(m){let y=m[3]?(m[3].length===2?2000:+0)+Number(m[3]):base.getUTCFullYear();let date=validDate(y,+m[2],+m[1]);if(date&&date<today&&!m[3])date=validDate(y+1,+m[2],+m[1]);return {date,ambiguous:!date||date<today};}
 const months=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
 m=t.match(/\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/);
 if(m){let y=Number(m[3]||base.getUTCFullYear());let date=validDate(y,months.indexOf(m[2])+1,+m[1]);if(date&&date<today&&!m[3])date=validDate(y+1,months.indexOf(m[2])+1,+m[1]);return {date,ambiguous:!date||date<today};}
 m=t.match(/\bdia\s+(\d{1,2})\b/);
 if(m){let y=base.getUTCFullYear(),month=base.getUTCMonth()+1; if(+m[1]<base.getUTCDate()){month++;if(month===13){month=1;y++;}}const date=validDate(y,month,+m[1]);return {date,ambiguous:!date};}
 if(week)return {ambiguous:true};
 return {};
}
const words={uma:1,um:1,duas:2,dois:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12};
export function parseTime(text){
 const t=normalize(text);let hour,minute=0,explicit=false;
 if(/meio[- ]dia/.test(t)){hour=12;explicit=true;}
 else if(/meia[- ]noite/.test(t)){hour=0;explicit=true;}
 else{
  const m=t.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?\b)/)||t.match(/\b(?:as|pelas|das|depois das|antes das)\s+(\d{1,2})(?:\s+horas)?\b/)||t.match(/^(\d{1,2})$/);
  if(m){hour=+m[1];minute=+(m[2]||m[3]||0);explicit=hour>12||hour===0;}
  else {const w=t.match(/\b(?:as|pelas|das|ser|horario de)\s+(uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+e\s+(meia|quinze|trinta|quarenta e cinco))?\b/);if(w){hour=words[w[1]];minute={meia:30,quinze:15,trinta:30,'quarenta e cinco':45}[w[2]]||0;}}
 }
 if(hour===undefined)return null;
 if(/(?:da|a) (?:tarde|noite)/.test(t)){if(hour<12)hour+=12;explicit=true;}
 if(/(?:da|de) manha|madrugada/.test(t)){if(hour===12)hour=0;explicit=true;}
 if(hour>23||minute>59)return {invalid:true};
 return {hour,minute,ambiguous:!explicit&&hour>=1&&hour<=11};
}
export function interpret(text,today,state={}){
 const t=normalize(text).replace(/[.!]+$/,'');
 // Negation/correction is evaluated before any positive acknowledgement.
 if(/^(deixa (como esta|como estava|pra la|para la)|esquece|desisti|desisto|nao precisa(?: mais)?|manter horario atual|desistir da remarcacao|cancela(?:r)? (?:a )?remarcacao)$/.test(t))return {type:'abandon'};
 if(/\bcancel/.test(t))return {type:'cancel_question'};
 if(/\b(todos|todas|os dois|as duas consultas|dois atendimentos|dois agendamentos)\b/.test(t))return {type:'change_target'};
 if(/^(sim|sim pode|sim pode remarcar|pode confirmar|confirmo|confirmar|pode remarcar|pode sim|isso|isso mesmo|esse mesmo|essa mesma|fechado|pode ser|ok|beleza)$/.test(t)&&!text.includes('?'))return {type:'affirm'};
 if(/^(nao|nao quero|outro horario|outra opcao)$/.test(t))return {type:'reject'};
 const ordinalOnly=t.match(/^(?:(?:quero|pode ser|escolho)\s+)?[ao]\s+(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|ultim[ao])(?:\s+(?:opcao|horario))?$/);
 if(ordinalOnly&&['offer','confirm'].includes(state.stage))return {type:'ordinal',index:ordinalOnly[1].startsWith('ultim')?-1:['primeir','segund','terceir','quart','quint'].findIndex(w=>ordinalOnly[1].startsWith(w))};
 const person=t.match(/\bcom\s+(?:a\s+|o\s+)?(\p{L}+)/u);
 if(person&&!['mesma','mesmo','ela','ele'].includes(person[1]))return {type:'change_target'};
 if(/\b(?:da|do|cliente|profissional) (?!semana\b|proxima\b|tarde\b|manha\b|noite\b|dia\b|horario\b|atendimento\b|mesm[ao]\b)\p{L}+/u.test(t))return {type:'change_target'};
 const date=parseDate(text,today);
 const time=parseTime(text);
 if(time&&/\bou\b/.test(t))return {type:'clarify_time'};
 let period=/\bmanha\b/.test(t)?'morning':/\btarde\b/.test(t)?'afternoon':/\bnoite\b/.test(t)?'evening':null;
 if(/fim do dia|final do dia/.test(t))period='late';
 const after=/depois d[ae]s|apos (?:as )?/.test(t),before=/antes d[ae]s/.test(t);
 if(date.ambiguous)return {type:'clarify_date'};
 if(date.date)return {type:'date',date:date.date,period,time:time?.invalid?null:time,after,before,sameTime:/mesmo horario/.test(t)};
 if(/\bnao\b/.test(t)&&time)return {type:'clarify_time'};
 if(/depois do almoco|antes do almoco/.test(t))return {type:'clarify_time'};
 if(/mesmo horario/.test(t))return {type:'same_time'};
 if(/mais (?:cedo|tarde)/.test(t))return {type:'relative_time',direction:t.includes('cedo')?'earlier':'later'};
 if(time?.invalid)return {type:'clarify_time'};
 if(time)return {type:after||before?'filter_time':'time',time,after,before,query:/\?|\b(tem|teria|existe|disponivel|consegue)\b/.test(t)};
 const ord=t.match(/\b(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|ultim[ao])\b/);
 if(ord)return {type:'ordinal',index:ord[1].startsWith('ultim')?-1:['primeir','segund','terceir','quart','quint'].findIndex(w=>ord[1].startsWith(w))};
 if(period)return {type:'period',period};
 if(/\b(remarc|reagend|muda|troca|adiar|antecip)/.test(t))return {type:'start'};
 if(state.stage==='date'&&/semana|dia|feira/.test(t))return {type:'clarify_date'};
 return {type:'unknown'};
}
export const minutes=start=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(start)).split(':');return +parts[0]*60+ +parts[1];};
export function timeMatches(slots,time){
 if(!time||time.invalid)return [];
 const targets=[time.hour*60+time.minute];if(time.ambiguous)targets.push((time.hour+12)*60+time.minute);
 return slots.filter(s=>targets.includes(minutes(s)));
}
export function filterSlots(slots,pref={}){
 const bounds={morning:[0,720],afternoon:[720,1080],evening:[1080,1440],late:[960,1440]};
 return slots.filter(s=>{const m=minutes(s);const b=bounds[pref.period];return (!b||m>=b[0]&&m<b[1])&&(pref.after==null||m>pref.after)&&(pref.before==null||m<pref.before);});
}
