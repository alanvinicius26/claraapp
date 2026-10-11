import { defineConfig, loadEnv } from "vite";
import {
  validateDeploymentEnv,
  allowCustomerSharing,
} from "./scripts/deployment-config.js";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  validateDeploymentEnv(env);
  return {
    define: {
      "import.meta.env.VITE_CAN_SHARE_LINKS": JSON.stringify(
        allowCustomerSharing(env),
      ),
    },
    server: { headers: { "Referrer-Policy": "no-referrer" } },
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
