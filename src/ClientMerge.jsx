import React, { useState } from "react";
import { rpc } from "./lib";

export default function ClientMerge({ client, clients, protect, mutate, saving }) {
  const [targetId, setTargetId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const target = clients.find((c) => c.id === targetId && c.id !== client.id);
  return <details className="note-box">
    <summary>Revisar cadastro duplicado</summary>
    <p>Use apenas depois de confirmar com a cliente que os dois cadastros são da mesma pessoa.</p>
    <label className="field">
      <span>Cadastro principal que será mantido</span>
      <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setConfirmed(false); }}>
        <option value="">Selecione a cliente</option>
        {clients.filter((c) => c.id !== client.id).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone || c.email || "Sem contato"}</option>)}
      </select>
    </label>
    {target && <>
      <p><strong>Cadastro atual:</strong> {client.name} · {client.phone || "Sem telefone"} · {client.email || "Sem e-mail"}</p>
      <p><strong>Cadastro principal:</strong> {target.name} · {target.phone || "Sem telefone"} · {target.email || "Sem e-mail"}</p>
      <p>Os atendimentos e observações serão reunidos em {target.name}. Os contatos do cadastro principal serão mantidos. O cadastro anterior ficará arquivado, sem apagar seus dados. Não há desfazer pelo painel.</p>
      <label className="check-field"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Conferi os dados e confirmo que é a mesma pessoa.</label>
      <button type="button" className="button secondary" disabled={!confirmed || saving} onClick={() => protect(() => mutate(() => rpc("merge_clients", { p_source: client.id, p_target: target.id }), "Cadastros unificados. Histórico preservado."))}>
        {saving ? "Unificando..." : "Confirmar unificação"}
      </button>
    </>}
  </details>;
}
