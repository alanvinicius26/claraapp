export function claraMilestoneFor(event, { services, appointments }) {
  if (event === "service-created" && services.length === 0) return "first-service";
  if (event === "appointment-completed" && !appointments.some(a => a.status === "completed")) return "first-completed";
  return null;
}

const seen = new Set();
export function claimClaraMilestone(studioId, milestone, storage) {
  if (!studioId || !milestone) return false;
  const key = `clara:milestone:v1:${studioId}:${milestone}`;
  if (seen.has(key)) return false;
  try {
    if (storage?.getItem(key)) { seen.add(key); return false; }
    storage?.setItem(key, "seen");
  } catch { /* Local persistence is optional; the successful action still stands. */ }
  seen.add(key);
  return true;
}
