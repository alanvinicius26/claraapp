import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=new URL('../integrations/n8n/',import.meta.url);await mkdir(root,{recursive:true});
const edge=name=>({main:[[{node:name,type:'main',index:0}]]});
for(const local of [true,false]) {
 const label=local?'LOCAL':'OFICIAL', credential={httpHeaderAuth:{id:local?'clara-whatsapp-local-header':'clara-whatsapp-production-header',name:local?'Clara — ponte local (simulação)':'Clara — ponte oficial'}};
 const base=local?'http://host.docker.internal:8787':(process.env.CLARA_WHATSAPP_BASE_URL||'https://gtqcehwvddvqllicnreu.supabase.co/functions/v1/whatsapp');
 const http=(name,path,pos)=>({id:randomUUID(),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:pos,credentials:credential,retryOnFail:false,
  parameters:{method:'POST',url:base+'/'+path,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'{}',options:{timeout:120000}}});
 const nodes=[
  {id:randomUUID(),name:'Iniciar operação',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},
  {id:randomUUID(),name:'Verificação a cada minuto',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,180],parameters:{rule:{interval:[{field:'minutes',minutesInterval:1}]}}},
  {id:randomUUID(),webhookId:randomUUID(),name:'Acordar com novo evento',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,-180],credentials:credential,
   parameters:{httpMethod:'POST',path:local?'clara-operations-local':'clara-operations',authentication:'headerAuth',responseMode:'onReceived',options:{}}},
  http('Receber e encaminhar atendimentos','inbox',[300,0]),
  http('Enviar respostas e notificações devidas','process',[600,0]),
  http('Verificar pendências e falhas','health',[900,0]),
  {id:randomUUID(),name:'Precisa de atenção?',type:'n8n-nodes-base.if',typeVersion:2.2,position:[1200,0],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:'={{ $json.needs_attention }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}},
  http('Registrar incidente sem dados pessoais','incident',[1500,-100]),
  {id:randomUUID(),name:'Ciclo concluído',type:'n8n-nodes-base.noOp',typeVersion:1,position:[1750,70],parameters:{}},
  {id:randomUUID(),name:'Como o atendimento funciona',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[260,-530],parameters:{width:1380,height:330,content:`## Clara — Atendimento completo [${label}]\n\n**Entrada oficial:** Meta → webhook HTTPS da Clara → assinatura conferida → evento salvo no banco → este fluxo. O webhook de despertar recebe só {} com autenticação.\n\n**Receber e encaminhar:** identifica o estabelecimento → evita repetir entrada → saudação com botões → Agendar envia o link correto; Atendente registra solicitação e pausa o bot. Recibos atualizam o histórico.\n\n**Respostas e notificações:** envio manual do painel + confirmação ao reservar + lembrete configurado + alteração/cancelamento. Confere consentimento, janela de 24h/modelo, pausa humana e versão da reserva.\n\n**Confiabilidade:** a Clara mantém filas, isolamento, bloqueios simultâneos e tentativas. Resultado incerto nunca é reenviado automaticamente. HTTP aceito não significa entregue.\n\n${local?'Este fluxo usa o simulador isolado. Não envia mensagens reais.':'Configurar os quatro nós HTTP e a credencial oficial antes de ativar. O envio também depende das travas do servidor e de cada estabelecimento.'}`}},
 ];
 const connections={'Iniciar operação':edge('Receber e encaminhar atendimentos'),'Verificação a cada minuto':edge('Receber e encaminhar atendimentos'),'Acordar com novo evento':edge('Receber e encaminhar atendimentos'),
  'Receber e encaminhar atendimentos':edge('Enviar respostas e notificações devidas'),'Enviar respostas e notificações devidas':edge('Verificar pendências e falhas'),'Verificar pendências e falhas':edge('Precisa de atenção?'),
  'Precisa de atenção?':{main:[[{node:'Registrar incidente sem dados pessoais',type:'main',index:0}],[{node:'Ciclo concluído',type:'main',index:0}]]},'Registrar incidente sem dados pessoais':edge('Ciclo concluído')};
 const workflow={id:local?'ClaraFullLocal01':'ClaraFullLive01',name:`Clara — Atendimento completo [${label}]`,active:false,nodes,connections,
  settings:{executionOrder:'v1',timezone:'America/Sao_Paulo',saveExecutionProgress:false,saveManualExecutions:false,saveDataErrorExecution:'none',saveDataSuccessExecution:'none'}};
 await writeFile(new URL(local?'clara-atendimento.local.json':'clara-atendimento.oficial.json',root),JSON.stringify(workflow,null,2)+'\n');
}
console.log('Fluxos completos gerados. Oficial inativo e sem credenciais.');
