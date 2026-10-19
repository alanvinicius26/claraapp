import React from "react";
import { Coffee } from "lucide-react";
import { weekdays, defaultBreak } from "./hours-validation.js";

export { weekdays };

const hhmm = (value) => (value || "").slice(0, 5);

// One compact row per weekday. `change(weekday, field, value)` is the
// caller's state setter; the data shape matches working_hours.
export default function HoursEditor({ hours, change, breakLabel = "Pausa" }) {
  return (
    <div className="hours-editor" role="group" aria-label="Expediente da semana">
      <div className="hours-editor-head" aria-hidden="true">
        <span>Dia</span>
        <span>Atendimento</span>
        <span>Pausa</span>
      </div>
      {hours.map((h) => {
        const day = weekdays[h.weekday];
        const hasBreak = h.break_start != null;
        return (
          <div
            className={`hours-row ${h.enabled ? "" : "is-off"}`}
            key={h.weekday}
          >
            <label className="hours-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={h.enabled}
                onChange={(e) => change(h.weekday, "enabled", e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              <strong>{day}</strong>
            </label>
            {h.enabled ? (
              <>
                <div className="hours-range">
                  <input
                    aria-label={`Abre ${day}`}
                    type="time"
                    required
                    value={hhmm(h.opens)}
                    onChange={(e) => change(h.weekday, "opens", e.target.value)}
                  />
                  <span aria-hidden="true">até</span>
                  <input
                    aria-label={`Fecha ${day}`}
                    type="time"
                    required
                    value={hhmm(h.closes)}
                    onChange={(e) => change(h.weekday, "closes", e.target.value)}
                  />
                </div>
                <div className="hours-break">
                  <label className="hours-break-toggle">
                    <input
                      type="checkbox"
                      checked={hasBreak}
                      onChange={(e) => {
                        const pause = e.target.checked
                          ? defaultBreak(h.opens, h.closes)
                          : { break_start: null, break_end: null };
                        change(h.weekday, "break_start", pause.break_start);
                        change(h.weekday, "break_end", pause.break_end);
                      }}
                    />
                    <Coffee size={14} aria-hidden="true" />
                    <span>{breakLabel}</span>
                  </label>
                  {hasBreak && (
                    <div className="hours-range">
                      <input
                        aria-label={`Início da pausa ${day}`}
                        type="time"
                        required
                        value={hhmm(h.break_start)}
                        onChange={(e) => change(h.weekday, "break_start", e.target.value)}
                      />
                      <span aria-hidden="true">até</span>
                      <input
                        aria-label={`Fim da pausa ${day}`}
                        type="time"
                        required
                        value={hhmm(h.break_end)}
                        onChange={(e) => change(h.weekday, "break_end", e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <span className="hours-off">Descanso</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
