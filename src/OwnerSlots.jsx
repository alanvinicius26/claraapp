import React, { useEffect, useState } from "react";
import { rpc, errorMessage } from "./lib";
import { time } from "./domain";

// No occupied times or customer details are sent to the browser by this RPC.
export default function OwnerSlots({ studioId, professionalId, services, date, appointmentId, value, onChange, refresh = 0 }) {
  const [state, setState] = useState({ key: "", slots: [], error: "" });
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([studioId, professionalId, services, date, appointmentId, refresh, retry]);
  useEffect(() => {
    let current = true;
    onChange("");
    if (!date || !professionalId || !services.length) {
      setState({ key, slots: [], error: "" });
      return;
    }
    rpc("owner_available_slots", { p_studio: studioId, p_professional: professionalId,
      p_services: services, p_date: date, p_appointment: appointmentId || null })
      .then((slots) => { if (current) setState({ key, slots: slots || [], error: "" }); })
      .catch((error) => { if (current) setState({ key, slots: [], error: errorMessage(error) }); });
    return () => { current = false; };
  }, [key]);
  const loading = state.key !== key;
  const currentValue = !loading && state.slots.some((slot) => time(slot.starts_at) === value) ? value : "";
  return <label className="field"><span>Horário livre · São Paulo</span>
    <select name="time" required value={currentValue} disabled={loading || !!state.error || !state.slots.length}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">{loading ? "Consultando agenda..." : "Selecione um horário livre"}</option>
      {!loading && state.slots.map((slot) => <option key={slot.starts_at} value={time(slot.starts_at)}>{time(slot.starts_at)}{slot.shared ? " · encaixe" : ""}</option>)}
    </select>
    {!loading && state.error && <small role="alert">{state.error}</small>}
    {!loading && !state.error && state.slots.find((slot) => time(slot.starts_at) === currentValue)?.shared &&
      <small>Encaixe: esta profissional já terá outra pessoa sendo atendida neste horário.</small>}
    {!loading && !state.error && !state.slots.length && <small>Selecione serviços, profissional e uma data com espaço para atendimento e limpeza.</small>}
    <button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>Atualizar horários</button>
  </label>;
}
