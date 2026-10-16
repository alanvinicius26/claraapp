// Duplicate clients by WhatsApp, detected inside the owner's panel only.
// Must match encaixa_private.phone_key (supabase/client_duplicates.sql); the
// database re-checks the key before merging (public.merge_client_group).
export function phoneKey(value) {
  let n = String(value || "").replace(/\D/g, "");
  if ((n.length === 12 || n.length === 13) && n.startsWith("55")) n = n.slice(2);
  if (/^[1-9][1-9][6-9]\d{7}$/.test(n)) return n.slice(0, 2) + "9" + n.slice(2);
  return /^[1-9][1-9]\d{8,9}$/.test(n) ? n : "";
}

// Groups of active clients sharing a WhatsApp key. In each group the suggested
// main record comes first: most completed visits, then an upcoming visit, then
// the oldest record.
export function duplicateGroups(clients, visitIndex = new Map()) {
  const byKey = new Map();
  for (const c of clients) {
    if (c.merged_into) continue;
    const key = phoneKey(c.phone);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), c]);
  }
  const score = (c) => {
    const v = visitIndex.get(c.id);
    return [v?.completed?.length || 0, v?.next ? 1 : 0];
  };
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key,
      clients: [...list].sort((a, b) => {
        const [va, na] = score(a), [vb, nb] = score(b);
        return vb - va || nb - na || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
      }),
    }))
    .sort((a, b) => a.clients[0].name.localeCompare(b.clients[0].name, "pt-BR"));
}

export const groupOf = (groups, clientId) => groups.find((g) => g.clients.some((c) => c.id === clientId)) || null;
