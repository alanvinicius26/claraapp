import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const folder=new URL('../integrations/n8n/',import.meta.url);
await mkdir(folder,{recursive:true});
const credential={httpHeaderAuth:{id:'clara-whatsapp-local-header',name:'Clara — ponte local (simulação)'}};
const http=(name,path,position,body='{}')=>({id:randomUUID(),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,
  parameters:{method:'POST',url:`http://host.docker.internal:8787/${path}`,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:120000}},credentials:credential,
  retryOnFail:false,notes:'Autenticação no gerenciador de credenciais. Não inserir segredo no workflow. Retentativas e duplicidades são controladas pela Clara.'});
const manual={id:randomUUID(),name:'Executar manualmente',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}};
const settings={executionOrder:'v1',timezone:'America/Sao_Paulo',saveExecutionProgress:false,saveManualExecutions:false,saveDataErrorExecution:'none',saveDataSuccessExecution:'none'};
const connection=(name)=>({main:[[{node:name,type:'main',index:0}]]});
const queue={name:'Clara — Fila de confirmações e lembretes [SIMULAÇÃO]',active:false,nodes:[manual,
 {id:randomUUID(),name:'A cada minuto',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,180],parameters:{rule:{interval:[{field:'minutes',minutesInterval:1}]}}},
 http('Processar fila persistente','process',[300,50])],connections:{'Executar manualmente':connection('Processar fila persistente'),'A cada minuto':connection('Processar fila persistente')},settings};
const inbound={name:'Clara — Cliente inicia conversa [SIMULAÇÃO]',active:false,nodes:[{...manual,id:randomUUID()},
 {id:randomUUID(),name:'Mensagem fictícia',type:'n8n-nodes-base.code',typeVersion:2,position:[250,0],parameters:{jsCode:"return [{json:{channel:'sim-studio-1',event_id:'sim-n8n-'+$execution.id,phone:'5511900000101',text:'Olá',timestamp:new Date().toISOString()}}];"},notes:'Altere text para Agendar ou Falar com atendente. Nunca use contatos reais neste fluxo.'},
 http('Registrar entrada','simulate-inbound',[500,0],'={{ JSON.stringify($json) }}'),http('Processar respostas','process',[750,0])],
 connections:{'Executar manualmente':connection('Mensagem fictícia'),'Mensagem fictícia':connection('Registrar entrada'),'Registrar entrada':connection('Processar respostas')},settings};
queue.id='ClaraWaQueueSim01'; inbound.id='ClaraWaInboxSim01';
for(const [file,workflow] of [['clara-queue.simulation.json',queue],['clara-inbound.simulation.json',inbound]])await writeFile(new URL(file,folder),JSON.stringify(workflow,null,2)+'\n');
console.log('Dois workflows importáveis gerados, sem segredos e sem envio real.');
