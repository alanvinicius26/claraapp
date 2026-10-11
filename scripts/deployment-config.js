export function validateDeploymentEnv(env) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url) throw new Error("Configure VITE_SUPABASE_URL antes do build.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    /* Report only the variable name. */
  }
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("VITE_SUPABASE_URL deve ser uma origem HTTP(S) válida.");
  }
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY deve conter uma chave sb_publishable_ válida; nunca use uma chave secreta ou service_role.",
    );
  }
}

export function allowCustomerSharing(env) {
  return (
    (!env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_TARGET_ENV) ||
    (env.VERCEL_TARGET_ENV || env.VERCEL_ENV) === "production"
  );
}
