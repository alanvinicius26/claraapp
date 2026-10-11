export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
}
export function validPhone(value) {
  return /^[1-9][0-9][2-9][0-9]{7,8}$/.test(normalizePhone(value));
}
