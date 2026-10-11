import { createClient } from "@supabase/supabase-js";
import { createTimedFetch, withDeadline } from "./network.js";
export { errorMessage } from "./network.js";
export const apiFetch = createTimedFetch();
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
    global: { fetch: apiFetch },
  },
);
export async function rpc(name, args = {}) {
  if (
    [
      "booking_page",
      "available_slots",
      "available_slots_multi",
      "available_dates_multi",
      "available_slots_team",
      "available_dates_team",
      "book_appointment_team",
      "book_appointment",
      "book_appointment_multi",
      "manage_booking",
    ].includes(name)
  ) {
    const response = await apiFetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/booking`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: name, args }),
      },
    );
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message || "Serviço indisponível."), { code: body.code, status: response.status });
    return body.data;
  }
  const { data, error } = await withDeadline(supabase.rpc(name, args));
  if (error) throw error;
  return data;
}
export async function query(request) {
  const { data, error } = await withDeadline(request);
  if (error) throw error;
  return data;
}
