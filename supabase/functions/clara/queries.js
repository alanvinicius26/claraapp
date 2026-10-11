const date=v=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
export async function extendedQuery(plan, read) {
 const term=plan.client?.trim();
 let client;
 if(term){
  const matches=await read('clients',{select:'id,name,phone,email,notes',merged_into:'is.null',name:'ilike.*'+term.replace(/[\\%_*]/g,'')+'*',order:'name',limit:'11'});
  if(matches.length!==1) return {answer:matches.length ? 'Encontrei mais de um cadastro. Informe o nome completo ou consulte Clientes:\n'+matches.slice(0,10).map(c=>c.name).join('\n') : 'Não encontrei um cliente com esse nome. Confira o cadastro em Clientes.'};
  client=matches[0];
 }
 if(plan.kind==='clients'&&!client) return {answer:'Informe o nome do cliente para consultar o cadastro e o histórico. Por exemplo: “Histórico da Maria Silva neste mês”.'};
 if(['services','team','studio'].includes(plan.kind)){
  const table={services:'services',team:'professionals',studio:'studios'}[plan.kind];
  const select={services:'name,price,duration,description,active',team:'name,active',studio:'name,phone,address,bio'}[plan.kind];
  const rows=await read(table,{select,limit:'51'});
  return {answer:rows.length?rows.slice(0,50).map(r=>[r.name,r.price!==undefined?money(r.price)+' · '+r.duration+' min':null,r.active!==undefined?(r.active?'Ativo':'Inativo'):null,r.description,r.phone,r.address,r.bio].filter(Boolean).join('\n')).join('\n\n')+(rows.length>50?'\nMostrando os primeiros 50 registros.':''):'Nenhum registro encontrado.'};
 }
 const params={select:'id,starts_at,service_name,status,price,clients(name),professionals(name)',order:'starts_at',limit:'31'};
 if(client) params.client_id='eq.'+client.id;
 if(plan.kind==='next') {params.starts_at='gte.'+new Date().toISOString();params.status='eq.confirmed';params.limit='1';}
 else {params.and=`(starts_at.gte.${plan.from}T00:00:00-03:00,starts_at.lt.${new Date(Date.parse(plan.to)+86400000).toISOString().slice(0,10)}T00:00:00-03:00)`;}
 const rows=await read('appointments',params);
 const labels={confirmed:'Confirmado',completed:'Concluído',cancelled:'Cancelado',blocked:'Bloqueio'};
 const prefix=client?`${client.name}\nTelefone: ${client.phone||'não informado'}\nE-mail: ${client.email||'não informado'}\nObservações: ${client.notes||'não informadas'}\n\n`:'';
 return {answer:prefix+`Atendimentos ${plan.kind==='next'?'a partir de agora':`de ${plan.from} a ${plan.to}`}:\n\n`+(rows.length?rows.slice(0,30).map(a=>`${date(a.starts_at)} · ${a.clients?.name||'Sem cliente'}\n${a.service_name} · ${a.professionals?.name||'Profissional'}\n${labels[a.status]||a.status} · ${money(a.price)}`).join('\n\n'):'Nenhum atendimento encontrado.')+(rows.length>30?'\n\nMostrando os primeiros 30. Reduza o período para ver os demais.':''),context:plan.kind==='next'&&rows.length===1?{appointmentId:rows[0].id}:null,actions:rows.slice(0,30).filter(a=>a.status==='confirmed').map(a=>({id:a.id,label:`Ver / remarcar: ${a.clients?.name||a.service_name} · ${date(a.starts_at)}`}))};
}
