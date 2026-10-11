// Isolated fixtures shared by conversation tests and the local browser test page.
import {handleDialogue,dialogueView} from '../supabase/functions/clara/dialogue.js';
export function createHarness(){
 const appointmentId='11111111-1111-4111-8111-111111111111';
 let data={revision:0,state:{stage:'identified',appointmentId}},commits=0,sequence=0;
 const tickets=new Map();
 const rpc=async(name,args={})=>{
  if(name==='clara_dialogue_get')return structuredClone(data);
  if(name==='clara_dialogue_save'){
   if(args.p_revision!==data.revision)throw new Error('Stale revision');
   data={revision:data.revision+1,state:structuredClone(args.p_state)};return structuredClone(data);
  }
  if(name==='clara_reschedule_options'){
   const ticket='22222222-2222-4222-8222-'+String(++sequence).padStart(12,'0');
   const options={ticket,appointmentId,client:'Ana Teste',service:'Manicure',professional:'Bia Teste',oldStart:'2026-10-05T12:00:00Z',date:args.p_date,expiresAt:new Date(Date.now()+900000).toISOString(),slots:['09:00','11:00','14:00','14:30','16:00'].map(t=>args.p_date+'T'+t+':00-03:00')};tickets.set(ticket,options);return options;
  }
  if(name==='clara_dialogue_commit'){
   if(args.p_revision!==data.revision||data.state.stage!=='confirm'||args.p_ticket!==data.state.ticket||args.p_start!==data.state.pendingStart)throw new Error('Inactive confirmation');
   const options=tickets.get(args.p_ticket);if(!options?.slots.includes(args.p_start))throw new Error('Invalid slot');
   commits++;data={revision:data.revision+1,state:{stage:'identified',appointmentId}};
   return {...structuredClone(data),result:{...options,studio:'Estúdio Teste',phone:'11999998888',startsAt:args.p_start}};
  }
  throw new Error('Unexpected RPC '+name);
 };
 const turn=(text,action)=>handleDialogue({text,action,dialogue:structuredClone(data),today:'2026-10-05',rpc});
 return {rpc,turn,view:()=>dialogueView(data),state:()=>structuredClone(data),commits:()=>commits};
}
