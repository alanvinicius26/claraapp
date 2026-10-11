import React, { useEffect, useId, useRef, useState } from "react";
import { rpc } from "./lib";

export default function StudioLinkField({ initialValue = "", demo = false }) {
  const [value, setValue] = useState(initialValue);
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const id = useId();
  const valid = /^[a-z0-9][a-z0-9-]{2,59}$/.test(value);
  const status = result?.value === value ? result.status : "checking";

  useEffect(() => {
    let cancelled = false;
    if (!valid || demo) return;
    const timer = setTimeout(async () => {
      try {
        const available = await rpc("studio_link_available", { p_slug: value });
        if (!cancelled)
          setResult({ value, status: available ? "available" : "taken" });
      } catch {
        if (!cancelled) setResult({ value, status: "error" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, valid, demo]);

  useEffect(() => {
    input.current?.setCustomValidity(
      status === "taken" ? "Este link já está em uso. Escolha outro nome." : "",
    );
  }, [status]);

  return (
    <div className="studio-link-field">
      <label htmlFor={id}>Link personalizado</label>
      <input
        ref={input}
        id={id}
        name="slug"
        value={value}
        required
        pattern="[a-z0-9][a-z0-9-]{2,59}"
        minLength={3}
        maxLength={60}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={`${id}-hint ${id}-status`}
        aria-invalid={status === "taken" ? true : undefined}
        onChange={(event) => {
          event.target.setCustomValidity("");
          setValue(event.target.value.toLowerCase());
        }}
      />
      <p id={`${id}-hint`} className="micro">
        Use de 3 a 60 caracteres: letras minúsculas, números e hífens.
      </p>
      <p className="studio-link-preview">
        {location.origin}/#/booking/
        <strong>{value || "nome-do-seu-espaco"}</strong>
      </p>
      <p id={`${id}-status`} className="micro" role="status">
        {!valid
          ? "Escolha o nome que aparecerá no seu link."
          : demo
            ? "Prévia de demonstração. Nenhum endereço será reservado."
            : status === "taken"
              ? "Este link já está em uso. Tente incluir seu bairro ou cidade."
              : status === "available"
                ? "Este link está disponível para seu espaço. A reserva será confirmada ao salvar."
                : status === "error"
                  ? "Não foi possível consultar agora. A disponibilidade será validada ao salvar."
                  : "Verificando disponibilidade…"}
      </p>
    </div>
  );
}
