import React, { useMemo, useState } from "react";
import { duplicateGroups, groupOf } from "./client-duplicates";
import { indexClientVisits } from "./dashboard-data.js";
import { Users, Merge } from "lucide-react";
import "./client-duplicates.css";

const visitsLabel = (n) => (n === 1 ? "1 visita" : `${n} visitas`);
const since = (value) => value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", month: "short", year: "numeric" }) : "";

// One group: choose the main record (suggested first) and merge in one click.
function Group({ group, visits, onMerge, saving, onSelect }) {
  const [main, setMain] = useState(group.clients[0].id);
  const target = group.clients.find((c) => c.id === main) || group.clients[0];
  const sources = group.clients.filter((c) => c.id !== target.id).map((c) => c.id);
  return <li className="dup-group">
    <fieldset>
      <legend>Mesmo WhatsApp: {target.phone}</legend>
      {group.clients.map((c) => <label key={c.id} className="dup-option">
        <input type="radio" name={`dup-${group.key}`} checked={c.id === target.id} onChange={() => setMain(c.id)} />
        <span><strong>{c.name}</strong><small>{visitsLabel(visits(c))}{c.email ? ` · ${c.email}` : ""}{c.created_at ? ` · desde ${since(c.created_at)}` : ""}</small></span>
        <button type="button" className="text-button" onClick={() => onSelect(c.id)}>Ver</button>
      </label>)}
    </fieldset>
    <button type="button" className="button primary" disabled={saving} onClick={() => onMerge(target.id, sources)}>
      <Merge size={16} /> Unificar em {target.name}
    </button>
  </li>;
}

export function DuplicatesPanel({ groups, visits, onMerge, saving, onSelect }) {
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + g.clients.length, 0);
  return <details className="dup-panel">
    <summary>
      <Users size={18} aria-hidden="true" />
      <span><strong>{groups.length === 1 ? "1 cliente parece ter cadastro duplicado" : `${groups.length} clientes parecem ter cadastros duplicados`}</strong>
        {" "}({total} cadastros com o mesmo WhatsApp). Revisar e unificar</span>
    </summary>
    <p className="micro">Reservas online sempre criam um cadastro novo, por privacidade. Unificar junta histórico, observações e e-mail no cadastro principal; nomes e e-mails diferentes ficam anotados nas observações internas. O outro cadastro fica arquivado, sem apagar dados. Não há desfazer pelo painel.</p>
    <ul>{groups.map((g) => <Group key={g.key + g.clients.map((c) => c.id).join()} group={g} visits={visits} onMerge={onMerge} saving={saving} onSelect={onSelect} />)}</ul>
  </details>;
}

// Shown in the client detail when the selected record belongs to a group.
export function DuplicateSuggestion({ group, client, visits, onMerge, saving }) {
  if (!group || !client) return null;
  const others = group.clients.filter((c) => c.id !== client.id);
  const suggested = group.clients[0];
  const all = (target) => group.clients.filter((c) => c.id !== target.id).map((c) => c.id);
  return <div className="note-box dup-suggestion" role="note">
    <h3><Users size={16} aria-hidden="true" /> Possível cadastro duplicado</h3>
    <p>Mesmo WhatsApp de {others.map((c) => `${c.name} (${visitsLabel(visits(c))})`).join(", ")}.</p>
    <div className="button-row">
      <button type="button" className="button primary" disabled={saving} onClick={() => onMerge(suggested.id, all(suggested))}>
        <Merge size={16} /> Unificar em {suggested.name}
      </button>
      {suggested.id !== client.id && <button type="button" className="button secondary" disabled={saving} onClick={() => onMerge(client.id, all(client))}>
        Manter este como principal
      </button>}
    </div>
  </div>;
}

// Appointment detail: same suggestion for the client of this appointment
// (typically a new online booking), computed from data already in the panel.
export function AppointmentDuplicateHint({ clientId, clients, appointments, onMerge, saving }) {
  const index = useMemo(() => indexClientVisits(appointments), [appointments]);
  const groups = useMemo(() => duplicateGroups(clients, index), [clients, index]);
  const group = groupOf(groups, clientId);
  const client = clients.find((c) => c.id === clientId);
  if (!group || !client) return null;
  return <DuplicateSuggestion group={group} client={client} visits={(c) => index.get(c.id)?.completed?.length || 0} onMerge={onMerge} saving={saving} />;
}
