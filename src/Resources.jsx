import React, { useEffect, useState } from "react";
import { supabase, query, errorMessage } from "./lib";

function useResources(studioId, demo = false) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoaded(false); setError("");
    if (demo) { setLoaded(true); return; }
    query(supabase.from("resources").select("*").eq("studio_id", studioId).order("name"))
      .then((data) => { if (current) { setRows(data); setLoaded(true); } })
      .catch((e) => { if (current) setError(errorMessage(e)); });
    return () => { current = false; };
  }, [studioId, revision, demo]);
  return { rows, error, loaded, reload: () => setRevision((n) => n + 1) };
}

export function ResourceField({ studioId, value }) {
  const { rows, error, loaded, reload } = useResources(studioId);
  return <label className="field"><span>Sala ou maca necessária</span>
    {/* A required loading placeholder prevents saving an accidental null resource. */}
    <select name="resource_id" defaultValue={value || "none"} key={loaded ? "ready" : "loading"} required>
      {!loaded ? <option value="">Carregando salas e macas...</option> : <>
        <option value="none">Não utiliza recurso compartilhado</option>
        {rows.filter((r) => r.active || r.id === value).map((r) => <option value={r.id} key={r.id}>{r.name}{r.active ? "" : " (inativa)"}</option>)}
      </>}
    </select>
    <small>Cadastre em Equipe. O recurso fica reservado por todo o atendimento e pela limpeza. Alterar este vínculo atualiza as reservas futuras; se houver conflito, a mudança será recusada.</small>
    {error && <small role="alert">{error} <button type="button" className="text-button" onClick={reload}>Tentar novamente</button></small>}
  </label>;
}

export default function Resources({ studio, protect, mutate, saving, demo }) {
  const { rows, loaded, error, reload } = useResources(studio.id, demo);
  return <section className="panel"><h2>Salas e macas compartilhadas</h2>
    <p>Cadastre cada sala ou maca e vincule o recurso necessário em Serviços. Duas profissionais não poderão reservar o mesmo recurso ao mesmo tempo.</p>
    <form onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget; const name = new FormData(form).get("name").trim();
      protect(() => mutate(async () => {
        await query(supabase.from("resources").insert({ studio_id: studio.id, name }));
        form.reset(); reload();
      }, "Sala ou maca cadastrada."));
    }}>
      <label className="field"><span>Nome da sala ou maca</span><input name="name" minLength={2} maxLength={100} required placeholder="Ex.: Maca 1" /></label>
      <button className="button primary" disabled={saving}>Adicionar sala ou maca</button>
    </form>
    {error ? <p role="alert">{error} <button className="text-button" onClick={reload}>Tentar novamente</button></p> : !loaded ? <p>Carregando recursos...</p> :
      <ul>{rows.map((r) => <li key={r.id}>{r.name} · {r.active ? "Ativa" : "Inativa"}{" "}
        <button className="text-button" disabled={saving} onClick={() => protect(() => mutate(async () => {
          await query(supabase.from("resources").update({ active: !r.active }).eq("id", r.id)); reload();
        }, "Recurso atualizado."))}>{r.active ? "Desativar" : "Ativar"}</button>
      </li>)}</ul>}
  </section>;
}
