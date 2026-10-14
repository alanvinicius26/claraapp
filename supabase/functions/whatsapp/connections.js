// Per-establishment credentials. Only this server module can decrypt them.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function keyFor(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('encryption_not_configured');
  return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g), h=>parseInt(h,16)), 'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealToken(token, studio, secret) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(studio)},await keyFor(secret),enc.encode(token));
  return {v:1,iv:b64(iv),data:b64(new Uint8Array(ciphertext))};
}
export async function openToken(value, studio, secret) {
  if(value?.v!==1)throw new Error('credential_missing');
  return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv),additionalData:enc.encode(studio)},await keyFor(secret),bytes(value.data)));
}
export function signupConfig(env) {
  const configured=env.META_ONBOARDING_ENABLED==='true' && /^\d+$/.test(env.META_APP_ID||'') && /^\d+$/.test(env.META_SIGNUP_CONFIG_ID||'') &&
    /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||'') && !!env.META_APP_SECRET && /^[a-f0-9]{64}$/i.test(env.WHATSAPP_TOKEN_ENCRYPTION_KEY||'');
  return {configured,app_id:configured?env.META_APP_ID:null,config_id:configured?env.META_SIGNUP_CONFIG_ID:null,
    version:configured?env.META_GRAPH_VERSION:null,coexistence:env.META_SIGNUP_COEXISTENCE==='true'};
}
export function metaConnections(env, request=fetch) {
  const validId = id => {if(!/^\d{1,40}$/.test(id||''))throw new Error('invalid_asset');return id;};
  const graph = async(path, token, method='GET', data) => {
    if(!signupConfig(env).configured)throw new Error('onboarding_not_configured');
    const response=await request(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok || result.error)throw new Error('meta_connection_failed');
    return result;
  };
  return {
    async exchange(code,waba,phone) {
      validId(waba);validId(phone);
      if(typeof code!=='string'||code.length<10||code.length>4096)throw new Error('invalid_code');
      const params=new URLSearchParams({client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,code});
      const exchanged=await graph('oauth/access_token?'+params,`${env.META_APP_ID}|${env.META_APP_SECRET}`);
      if(!exchanged.access_token)throw new Error('invalid_token');
      const token=exchanged.access_token;
      const debug=await graph('debug_token?'+new URLSearchParams({input_token:token}),`${env.META_APP_ID}|${env.META_APP_SECRET}`);
      if(!debug.data?.is_valid || debug.data.app_id!==env.META_APP_ID ||
        !['whatsapp_business_management','whatsapp_business_messaging'].every(s=>debug.data.scopes?.includes(s)))throw new Error('invalid_token_scope');
      let selected, after;
      for(let page=0;page<20;page++) {
        const list=await graph(`${waba}/phone_numbers?`+new URLSearchParams({fields:'id,display_phone_number,verified_name',limit:'100',...(after?{after}:{})}),token);
        selected=list.data?.find(p=>p.id===phone);if(selected)break;
        if(!list.paging?.next || !list.paging?.cursors?.after)break;after=list.paging.cursors.after;
      }
      if(!selected)throw new Error('phone_not_in_account');
      const subscribed=await graph(`${waba}/subscribed_apps`,token,'POST',{});
      if(subscribed.success!==true && subscribed.success!=='true')throw new Error('subscription_failed');
      return {token,waba_id:waba,phone_number_id:phone,display_phone:selected.display_phone_number||'',verified_name:selected.verified_name||''};
    },
    async register(phone,token,pin) {
      if(env.META_SIGNUP_COEXISTENCE==='true')throw new Error('registration_not_used_in_coexistence');
      if(!/^\d{6}$/.test(pin||''))throw new Error('invalid_pin');
      const result=await graph(`${validId(phone)}/register`,token,'POST',{messaging_product:'whatsapp',pin});
      if(result.success!==true && result.success!=='true')throw new Error('registration_failed');
      return {registered:true};
    },
    async templates(waba,token) {
      let after;const items=[];
      for(let page=0;page<20;page++) {
        const result=await graph(`${validId(waba)}/message_templates?`+new URLSearchParams({fields:'name,status,language,category,components',limit:'100',...(after?{after}:{})}),token);
        items.push(...(result.data||[]));if(!result.paging?.next || !result.paging?.cursors?.after)break;after=result.paging.cursors.after;
      }
      const map={};
      for(const kind of ['confirmation','reminder','reschedule','cancellation','human_followup']) {
        const name=`clara_${kind}_v1`, t=items.find(x=>x.name===name&&x.language==='pt_BR'&&x.status==='APPROVED'&&x.category==='UTILITY');
        // Reject templates with additional components or an incompatible parameter contract.
        const body=t?.components?.find(x=>x.type==='BODY');
        const placeholders=[...(body?.text||'').matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]);
        const expected=kind==='human_followup'?[]:['1','2','3','4','5','6'];
        if(t && t.components.length===1 && JSON.stringify(placeholders)===JSON.stringify(expected))map[kind]={name,language:t.language,approved:true};
      }
      return map;
    }
  };
}

export function connectionHandler({env,db,authenticate,meta=metaConnections(env)}) {
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return async req=>{
    if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
    try {
      const owner=await authenticate(req);
      if(!owner)return reply({error:'unauthorized'},401);
      const raw=await req.text();if(raw.length>8192)return reply({error:'invalid_request'},413);
      const {action,studio_id,session_id,code,waba_id,phone_number_id,pin}=JSON.parse(raw);
      if(!/^[a-f0-9-]{36}$/i.test(studio_id||''))return reply({error:'invalid_request'},400);
      const call=(a,data={})=>db('whatsapp_connect_control',{p_owner:owner,p_studio:studio_id,p_action:a,p_data:data});
      const state=await call('status'); // Ownership is checked before config or credentials.
      const config=signupConfig(env);
      if(action==='status')return reply({...state,config,live_enabled:env.WHATSAPP_MODE==='live'&&env.WHATSAPP_LIVE_ENABLED==='true'});
      if(action==='disconnect')return reply(await call('disconnect'));
      if(!config.configured)return reply({error:'onboarding_not_configured'},503);
      if(action==='begin')return reply({...await call('begin'),config});
      if(action==='complete') {
        await call('consume',{session_id});
        const connected=await meta.exchange(code,waba_id,phone_number_id);
        const token_cipher=await sealToken(connected.token,studio_id,env.WHATSAPP_TOKEN_ENCRYPTION_KEY);
        return reply(await call('save',{session_id,waba_id:connected.waba_id,phone_number_id:connected.phone_number_id,
          display_phone:connected.display_phone,verified_name:connected.verified_name,token_cipher}));
      }
      const secret=await call('credential',{phone_number_id:state.phone_number_id});
      if(!secret)return reply({error:'connection_required'},409);
      const token=await openToken(secret.token_cipher,studio_id,env.WHATSAPP_TOKEN_ENCRYPTION_KEY);
      if(action==='register')return reply(await meta.register(state.phone_number_id,token,pin));
      if(action==='templates')return reply(await call('templates',{generation:secret.generation,templates:await meta.templates(secret.waba_id,token)}));
      return reply({error:'invalid_action'},400);
    } catch { return reply({error:'connection_failed'},400); }
  };
}
