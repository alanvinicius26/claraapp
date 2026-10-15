// Only the e-mail is remembered, per device. Passwords stay with the browser's
// password manager (autocomplete="current-password"), never in app storage.
const key = "clara-last-login";

export function rememberedEmail(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(key) || "null");
    return typeof saved?.email === "string" && saved.email.length <= 254 ? saved.email : "";
  } catch {
    return "";
  }
}

export function rememberEmail(storage, email, remember) {
  try {
    if (remember && email) storage?.setItem(key, JSON.stringify({ email: email.trim().toLowerCase() }));
    else storage?.removeItem(key);
  } catch { /* Private mode or blocked storage: login still works. */ }
}
