import React,{useEffect,useState} from 'react';
import { connectionCall,loadSignupSDK,launchSignup } from './whatsapp-connection';
export default function WhatsAppConnection({studioId,notify,onChange}) {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState(null),[error,setError]=useState(''),[pin,setPin]=useState('');
  const refresh=async()=>{try{setState(await connectionCall(studioId,'status'));setError('');}catch(e){setError(e.message);}};
  useEffect(()=>{let current=true;setState(null);setPrepared(null);connectionCall(studioId,'status').then(v=>{if(current)setState(v);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[studioId]);
  const run=async(action,data={})=>{setBusy(true);try{await connectionCall(studioId,action,data);setPin('');setPrepared(null);await refresh();await onChange();notify(action==='disconnect'?'Conexão desativada na Clara.':'Configuração atualizada.');}catch(e){notify(e.message,true);}finally{setBusy(false);}};
  const prepare=async()=>{setBusy(true);try{const v=await connectionCall(studioId,'begin');await loadSignupSDK(v.config);setPrepared(v);}catch(e){notify(e.message,true);}finally{setBusy(false);}};
  const connect=async()=>{setBusy(true);try{const result=await launchSignup(prepared.config);await connectionCall(studioId,'complete',{...result,session_id:prepared.session_id});await refresh();await onChange();notify('Número conectado. Revise os modelos antes de ativar o atendimento.');}catch(e){notify(e.message,true);}finally{setPrepared(null);setBusy(false);}};
  return <section className="panel wa-connection"><h2>WhatsApp do estabelecimento</h2>
    {error?<p role="alert">{error}</p>:state?.status==='connected'?<p><strong>{state.verified_name}</strong> · {state.display_phone}<br/>Conectado à Clara{state.live_enabled?'':'; envio oficial ainda desabilitado'}.</p>:<p>Conecte o número da sua empresa para atender suas clientes pela Clara.</p>}
    {state && !state.config.configured && <p className="micro">A conexão oficial aguarda a configuração e as permissões da Meta. Seu atendimento local continua disponível.</p>}
    <div className="button-row"><button className="button primary" disabled={busy||!state?.config.configured} onClick={prepared?connect:prepare}>{prepared?'Continuar na Meta':state?.status==='connected'?'Reconectar WhatsApp':'Conectar WhatsApp'}</button>
      {state?.status==='connected'&&<><button className="button secondary" disabled={busy} onClick={()=>run('templates')}>Conferir modelos aprovados</button><button className="button secondary" disabled={busy} onClick={()=>run('disconnect')}>Desconectar da Clara</button></>}
    </div>
    {state?.status==='connected' && !state.config.coexistence && <details><summary>Concluir registro de um número novo na API</summary><p className="micro">Use somente se o cadastro da Meta solicitar o registro. Informe o PIN de seis dígitos desse número. O PIN não é guardado na Clara.</p><form onSubmit={e=>{e.preventDefault();run('register',{pin});}}><label className="field"><span>PIN de registro</span><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required/></label><button className="button secondary" disabled={busy}>Concluir registro</button></form></details>}
    <p className="micro">A autorização acontece na Meta. Desconectar interrompe a integração na Clara; o vínculo também pode ser revogado nas configurações da sua empresa na Meta.</p>
  </section>;
}
