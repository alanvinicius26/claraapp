import { apiFetch, supabase } from './lib';
const simulation=import.meta.env.DEV && import.meta.env.VITE_WHATSAPP_SIMULATION==='true';
const messages={onboarding_not_configured:'A conexão oficial aguarda a configuração da Meta pela Clara.',unauthorized:'Entre novamente para conectar seu WhatsApp.',connection_required:'Conecte o número antes de continuar.',connection_failed:'Não foi possível concluir. Confira a conta autorizada e inicie a conexão novamente.'};
export async function connectionCall(studio,action,data={}) {
  const session=simulation?null:(await supabase.auth.getSession()).data.session;
  const response=await apiFetch(simulation?'/whatsapp-sim/connection':`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/connection`,{
    method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({studio_id:studio,action,...data}),
  });
  const value=await response.json();if(!response.ok)throw new Error(messages[value.error]||'Não foi possível carregar a conexão.');return value;
}
let sdkReady;
export function loadSignupSDK(config) {
  if(!sdkReady)sdkReady=new Promise((resolve,reject)=>{
    const init=()=>{window.FB.init({appId:config.app_id,version:config.version,cookie:false,xfbml:false});resolve();};
    if(window.FB){init();return;}
    const script=document.createElement('script');script.src='https://connect.facebook.net/pt_BR/sdk.js';script.async=true;
    script.onload=init;script.onerror=()=>{sdkReady=null;reject(new Error('Não foi possível carregar a conexão da Meta.'));};document.head.appendChild(script);
  });
  return sdkReady;
}
// Called by a second direct click, after loading, to respect browser popup protection.
export function launchSignup(config) {
  return new Promise((resolve,reject)=>{
    let code,assets,done=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);window.removeEventListener('message',onMessage);error?reject(error):resolve({...assets,code});};
    const maybe=()=>{if(code&&assets)finish();};
    const onMessage=event=>{
      if(!['https://www.facebook.com','https://web.facebook.com'].includes(event.origin))return;
      let data;try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
      if(data?.type!=='WA_EMBEDDED_SIGNUP')return;
      if(['CANCEL','ERROR'].includes(data.event)){finish(new Error('Conexão não concluída na Meta. Você pode tentar novamente.'));return;}
      if(['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(data.event) && /^\d+$/.test(data.data?.waba_id||'') && /^\d+$/.test(data.data?.phone_number_id||'')){
        assets={waba_id:data.data.waba_id,phone_number_id:data.data.phone_number_id};maybe();
      }
    };
    const timer=setTimeout(()=>finish(new Error('A conexão expirou. Inicie novamente.')),180000);
    window.addEventListener('message',onMessage);
    try{window.FB.login(response=>{
      if(!response.authResponse?.code){finish(new Error('Autorização não concluída.'));return;}
      code=response.authResponse.code;maybe();
    },{config_id:config.config_id,auth_type:'rerequest',response_type:'code',override_default_response_type:true,extras:{setup:{},...(config.coexistence?{featureType:'whatsapp_business_app_onboarding'}:{})}});}catch{finish(new Error('Não foi possível abrir a Meta.'));}
  });
}
