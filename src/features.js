// Build-time switches. WhatsApp/n8n is on standby: off unless VITE_WHATSAPP_ENABLED=true
// (see scripts/deployment-config.js). When off, its screens are not even bundled.
export const whatsappEnabled = import.meta.env.VITE_WHATSAPP_ENABLED === "true";
