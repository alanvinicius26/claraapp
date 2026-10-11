import React, { useState } from "react";
import { Camera, LoaderCircle, X } from "lucide-react";
import { supabase, errorMessage, query } from "./lib";
export default function MediaUpload({
  initial = "",
  notify,
  disabled = false,
}) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      notify("Use uma imagem JPG, PNG ou WebP de até 5 MB.", true);
      return;
    }
    setBusy(true);
    try {
      const { user } = await query(supabase.auth.getUser());
      if (!user) throw new Error("Entre na sua conta para enviar fotos.");
      const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[file.type];
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      await query(
        supabase.storage
          .from("studio-media")
          .upload(path, file, { contentType: file.type, upsert: false }),
      );
      setUrl(
        supabase.storage.from("studio-media").getPublicUrl(path).data.publicUrl,
      );
      notify("Imagem enviada. Salve as alterações para aplicar.");
    } catch (err) {
      notify(errorMessage(err), true);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  return (
    <div className="media-upload">
      <input type="hidden" name="image_url" value={url} />
      {url && <img src={url} alt="Imagem escolhida" />}
      <div>
        <label className="button secondary compact">
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Camera size={16} />
          )}{" "}
          {busy ? "Enviando..." : url ? "Trocar foto" : "Adicionar foto"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={upload}
            disabled={busy || disabled}
            className="file-input"
            aria-label="Enviar foto"
          />
        </label>
        <p className="micro">
          JPG, PNG ou WebP · até 5 MB · visível às clientes
        </p>
        {url && (
          <button
            type="button"
            className="text-button"
            onClick={() => setUrl("")}
          >
            <X size={12} /> Remover foto
          </button>
        )}
      </div>
    </div>
  );
}
