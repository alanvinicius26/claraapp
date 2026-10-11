import React, { useState } from "react";
import { PARALLEL_MIN, PARALLEL_MAX } from "./parallel";

export { parallelServiceData, sharedAppointmentIds } from "./parallel";

export function ServiceParallelFields({ item }) {
  const [allows, setAllows] = useState(!!item?.allows_parallel);
  return (
    <fieldset className="parallel-fields">
      <legend>Encaixe</legend>
      <label className="check-field">
        <input
          name="allows_parallel"
          type="checkbox"
          checked={allows}
          onChange={(e) => setAllows(e.target.checked)}
        />{" "}
        Posso atender outra pessoa junto
      </label>
      {allows && (
        <label className="field">
          <span>Até quantas pessoas ao mesmo tempo</span>
          <input
            name="parallel_limit"
            type="number"
            min={PARALLEL_MIN}
            max={PARALLEL_MAX}
            step="1"
            defaultValue={item?.parallel_limit ?? PARALLEL_MIN}
            required
          />
        </label>
      )}
      <p className="micro">
        Vale para profissionais com “Faz encaixes” ativado em Equipe. Contam
        todas as pessoas atendidas juntas, incluindo a primeira. Uma sala ou
        maca vinculada continua atendendo uma pessoa por vez.
      </p>
    </fieldset>
  );
}

