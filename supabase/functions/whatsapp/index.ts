import { createHandler, simulationSender, metaSender } from "./core.js";
import { connectionHandler, openToken } from './connections.js';
const names = ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","APP_ORIGIN","CLARA_N8N_SECRET","WHATSAPP_MODE","WHATSAPP_LIVE_ENABLED","META_APP_SECRET","META_VERIFY_TOKEN","META_GRAPH_VERSION",
 "META_APP_ID","META_SIGNUP_CONFIG_ID","META_SIGNUP_COEXISTENCE","META_ONBOARDING_ENABLED","WHATSAPP_TOKEN_ENCRYPTION_KEY","N8N_WAKE_URL"];
const env = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
env.WHATSAPP_MODE ||= "simulation";
const db = async (name, args) => {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("database_error");
  return response.json();
};
const send = env.WHATSAPP_MODE === 'simulation' ? simulationSender() : metaSender(env,fetch,async job=>{
 const connection=await db('whatsapp_worker_connection',{p_studio:job.studio_id,p_channel:job.channel});
 return openToken(connection?.token_cipher,job.studio_id,env.WHATSAPP_TOKEN_ENCRYPTION_KEY);
});
const service=createHandler({env,db,send});
const connection=connectionHandler({env,db,authenticate:async req=>{
 const authorization=req.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return null;
 const response=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:authorization},signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;
 return (await response.json()).id || null;
}});
Deno.serve(async req=>{
 if(!new URL(req.url).pathname.endsWith('/connection')) {
  const result=await service(req);
  if(req.method==='POST' && new URL(req.url).pathname.endsWith('/webhook') && result.ok && env.N8N_WAKE_URL) {
   // Wake-up is only an optimization. The durable inbox and scheduled worker recover failures.
   EdgeRuntime.waitUntil((async()=>{try{
    const url=new URL(env.N8N_WAKE_URL);if(url.protocol!=='https:'||url.username||url.password)return;
    await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${env.CLARA_N8N_SECRET}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});
   }catch{/* No customer data or credentials in logs. */}})());
  }
  return result;
 }
 const origin=req.headers.get('origin');
 if(origin && origin!==env.APP_ORIGIN)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':env.APP_ORIGIN||'','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 const response=await connection(req);
 for(const [name,value] of Object.entries(headers))response.headers.set(name,value);
 return response;
});
