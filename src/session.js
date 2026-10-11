import { withDeadline } from "./network.js";

// Register first; a delayed bootstrap must never resurrect a signed-out account.
export function observeSession(
  auth,
  { onSession, onError, onRecovery },
  timeout = 20000,
) {
  let active = true,
    revision = 0;
  const { data } = auth.onAuthStateChange((event, session) => {
    if (!active) return;
    revision++;
    onSession(session);
    if (event === "PASSWORD_RECOVERY") onRecovery(session);
  });
  const initialRevision = 0;
  withDeadline(auth.getSession(), timeout)
    .then(({ data: result, error }) => {
      if (!active || revision !== initialRevision) return;
      if (error) throw error;
      onSession(result?.session || null);
    })
    .catch((error) => {
      if (active && revision === initialRevision) onError(error);
    });
  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}

export function recoveryUser(value) {
  try {
    if (value === null) sessionStorage.removeItem("clara-password-recovery");
    else if (value !== undefined)
      sessionStorage.setItem("clara-password-recovery", value);
    return sessionStorage.getItem("clara-password-recovery");
  } catch {
    return null;
  }
}
