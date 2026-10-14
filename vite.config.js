import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";
import {
  validateDeploymentEnv,
  allowCustomerSharing,
  whatsappFeature,
} from "./scripts/deployment-config.js";
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  validateDeploymentEnv(env);
  const simulation = mode === "whatsapp" && command === "serve";
  let panelSecret;
  if (simulation) {
    panelSecret = JSON.parse(readFileSync(".local/whatsapp-sim/server-secrets.json", "utf8")).PANEL_SECRET;
  }
  return {
    define: {
      "import.meta.env.VITE_WHATSAPP_SIMULATION": JSON.stringify(simulation ? "true" : "false"),
      "import.meta.env.VITE_WHATSAPP_ENABLED": JSON.stringify(whatsappFeature(env, simulation) ? "true" : "false"),
      ...(simulation ? {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1:8787"),
        "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_local_simulation"),
      } : {}),
      "import.meta.env.VITE_CAN_SHARE_LINKS": JSON.stringify(
        allowCustomerSharing(env),
      ),
    },
    server: { headers: { "Referrer-Policy": "no-referrer" }, ...(simulation ? {
      proxy: { "/whatsapp-sim": { target: "http://127.0.0.1:8787", headers: { "x-clara-panel": panelSecret } } },
    } : {}) },
    plugins: simulation ? [{ name: "local-simulation-origin", configureServer(server) {
      server.middlewares.use((req,res,next) => {
        if (req.url?.startsWith('/whatsapp-sim') && req.headers.origin && !['http://127.0.0.1:3000','http://localhost:3000'].includes(req.headers.origin)) {
          res.statusCode=403; res.end(); return;
        }
        next();
      });
    } }] : [],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "supabase", test: /node_modules[\\/]@supabase/ },
              {
                name: "react",
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              },
            ],
          },
        },
      },
    },
  };
});
