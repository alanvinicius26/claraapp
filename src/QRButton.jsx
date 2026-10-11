import React, { useState } from "react";
import { canShareLinks, sharingUnavailable } from "./sharing";
import { QrCode, LoaderCircle } from "lucide-react";
export default function QRButton({ link, demo, notify }) {
  const [busy, setBusy] = useState(false);
  async function generate() {
    if (!canShareLinks) {
      notify(sharingUnavailable);
      return;
    }
    if (demo) {
      notify("Crie seu espaço para gerar seu QR Code.");
      return;
    }
    setBusy(true);
    try {
      const QRCode = await import("qrcode");
      const url = await QRCode.toDataURL(link, {
        width: 1000,
        margin: 3,
        errorCorrectionLevel: "M",
        color: { dark: "#6e1936", light: "#ffffff" },
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "meu-estudio-qrcode.png";
      a.click();
      notify("QR Code pronto para imprimir e compartilhar.");
    } catch {
      notify("Não foi possível gerar o QR Code.", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className="button secondary"
      type="button"
      disabled={busy}
      onClick={generate}
    >
      {busy ? (
        <LoaderCircle size={17} className="spin" />
      ) : (
        <QrCode size={17} />
      )}{" "}
      Baixar QR Code
    </button>
  );
}
