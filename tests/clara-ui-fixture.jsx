// Isolated UI test; all requests are intercepted and use synthetic state.
import React from 'react';
import {createRoot} from 'react-dom/client';
import ClaraChat from '../src/ClaraChat';
import {supabase} from '../src/lib';
import {createHarness} from './clara-dialogue-harness.js';
import '../src/styles.css';
const harness=createHarness();
let delayNext=new URL(window.location.href).searchParams.has('slow');
supabase.auth.getSession=async()=>({data:{session:{access_token:'synthetic-ui-test'}}});
window.fetch=async(url,init)=>{
 if(!String(url).endsWith('/functions/v1/clara'))throw new Error('External network blocked by UI fixture');
 const request=JSON.parse(init.body);
 try{
  let body;
  if(!request.action&&/próximo atendimento/.test(request.message)){
   const current=harness.state();
   const d=await harness.rpc('clara_dialogue_save',{p_revision:current.revision,p_state:{stage:'identified',appointmentId:'11111111-1111-4111-8111-111111111111'}});
   body={answer:'Próximo atendimento: Ana Teste · Manicure.',dialogue:{revision:d.revision,stage:d.state.stage}};
  }else body=await harness.turn(request.message,request.action)||harness.view();
  if(delayNext&&!request.action){delayNext=false;await new Promise(resolve=>setTimeout(resolve,10000));}
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
 }catch(err){return new Response(JSON.stringify({message:err.message}),{status:409,headers:{'content-type':'application/json'}});}
};
createRoot(document.getElementById('root')).render(<><h1>Teste isolado da Clara</h1><p>Nenhum dado real é consultado ou alterado.</p><output id="qa-result">Aguardando confirmação</output><ClaraChat onRescheduled={()=>{document.getElementById('qa-result').textContent='Remarcações confirmadas: '+harness.commits();}}/></>);
