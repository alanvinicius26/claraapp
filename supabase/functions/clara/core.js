export function validatePlan(plan) {
 if(plan?.client===null) delete plan.client;
 if(plan?.answer===null) delete plan.answer;
 if (!plan || !["next","agenda","revenue","summary","help","clients","services","team","studio"].includes(plan.kind)) throw new Error("Não entendi a consulta. Tente informar o assunto e o período.");
 for (const key of ["from","to"]) {
  if (typeof plan[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan[key]) || !Number.isFinite(Date.parse(plan[key])) || new Date(plan[key]).toISOString().slice(0,10)!==plan[key]) throw new Error("Informe um período válido.");
 }
 const days=(Date.parse(plan.to)-Date.parse(plan.from))/86400000;
 if(days<0 || days>366) throw new Error("Consulte um período de até um ano.");
 if(plan.client!==undefined && (typeof plan.client!=="string" || plan.client.length>100)) throw new Error("Nome inválido.");
 if(plan.answer!==undefined && (typeof plan.answer!=="string" || plan.answer.length>4000)) throw new Error("Resposta inválida.");
 return plan;
}
const money = v => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
export function renderAnswer(plan,data) {
 const period=plan.from.split("-").reverse().join("/")+" a "+plan.to.split("-").reverse().join("/");
 if(plan.kind==="revenue") return "De "+period+", você recebeu "+money(data.received)+" em "+data.payments+" pagamento(s) registrado(s). Considero a data do recebimento, não a data do atendimento. Isso não representa lucro.";
 if(plan.kind==="summary") return "De "+period+": "+data.appointments+" atendimento(s), sendo "+data.completed+" concluído(s). Valor dos atendimentos confirmados e concluídos: "+money(data.scheduled_value)+". Esse valor não significa dinheiro recebido.";
 if(!data.length) return plan.kind==="next" ? "Você não tem próximos atendimentos confirmados." : "Nenhum atendimento confirmado ou concluído de "+period+".";
 const lines=data.slice(0,30).map(a=>new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(new Date(a.starts_at))+" · "+(a.client||"Cliente")+"\n"+a.service_name+" · "+(a.professional||"Profissional")+" · "+(a.status==="completed"?"Concluído":"Confirmado"));
 return (plan.kind==="next"?"Seu próximo atendimento:\n\n":"Sua agenda de "+period+":\n\n")+lines.join("\n\n")+(data.length>30?"\n\nMostrando os primeiros 30. Consulte um período menor para ver os demais.":"");
}

