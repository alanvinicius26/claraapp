import { readFileSync } from "node:fs";
export function stagingEnv() {
  const file = process.env.TEST_ENV_FILE;
  if (!file || process.env.ALLOW_STAGING_TESTS !== "yes")
    throw new Error(
      "Use TEST_ENV_FILE e ALLOW_STAGING_TESTS=yes com um projeto de testes dedicado.",
    );
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
  const url = new URL(env.VITE_SUPABASE_URL);
  if (url.hostname === "gtqcehwvddvqllicnreu.supabase.co")
    throw new Error("Testes de escrita são bloqueados no projeto de produção.");
  return env;
}
