// Run with k6 in an isolated staging environment. Never creates or emails users.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Rate } from "k6/metrics";
const api = __ENV.LOAD_API_ORIGIN,
  app = __ENV.LOAD_APP_ORIGIN,
  key = __ENV.LOAD_PUBLISHABLE_KEY;
if (
  __ENV.ALLOW_STAGING_LOAD !== "yes" ||
  !api ||
  !app ||
  !key ||
  api.includes("gtqcehwvddvqllicnreu") ||
  app.includes("encaixa-eta.vercel.app")
)
  throw new Error(
    "Informe um ambiente de homologação isolado; produção é bloqueada.",
  );
const users = new SharedArray("synthetic users", () =>
  JSON.parse(open(__ENV.LOAD_USERS_FILE)),
);
if (users.length < 1000)
  throw new Error(
    "Prepare 1.000 contas sintéticas distintas com access_token, studio_id e slug.",
  );
if (
  new Set(users.map((user) => user.studio_id)).size !== users.length ||
  users.some((user) => !user.access_token || !user.studio_id || !user.slug)
)
  throw new Error(
    "Cada usuário precisa ter seu próprio estúdio, token e endereço.",
  );
const applicationErrors = new Rate("application_errors");
export const options = {
  scenarios: {
    owners: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 },
        { duration: "3m", target: 500 },
        { duration: "5m", target: 1000 },
        { duration: "15m", target: 1000 },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "90s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    application_errors: ["rate<0.01"],
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
  },
};
function checked(response, label) {
  const ok = check(response, {
    [label]: (r) => r.status >= 200 && r.status < 300,
  });
  applicationErrors.add(!ok);
  return ok;
}
let previousRevision;
export default function () {
  const user = users[__VU - 1];
  const headers = {
    apikey: key,
    Authorization: `Bearer ${user.access_token}`,
    "Content-Type": "application/json",
  };
  if (__ITER === 0) {
    checked(http.get(app, { tags: { name: "app_document" } }), "app document");
  }
  const revision = http.post(
    api + "/rest/v1/rpc/dashboard_revision",
    JSON.stringify({ p_studio: user.studio_id }),
    { headers, tags: { name: "dashboard_revision" }, timeout: "15s" },
  );
  if (checked(revision, "revision")) {
    const current = revision.json();
    if (__ITER === 0 || current !== previousRevision) {
      const tables = [
        "studios",
        "clients",
        "services",
        "appointments",
        "payments",
        "professionals",
      ];
      let pending = tables.map((table) => ({ table, cursor: "" }));
      for (let page = 0; pending.length && page < 200; page++) {
        const responses = http.batch(
          pending.map(({ table, cursor }) => [
            "GET",
            api +
              "/rest/v1/" +
              table +
              "?select=" +
              encodeURIComponent(
                table === "appointments" ? "*,clients(name,phone,email)" : "*",
              ) +
              "&" +
              (table === "studios" ? "id" : "studio_id") +
              "=eq." +
              user.studio_id +
              "&order=id.asc&limit=500" +
              (table === "clients" ? "&merged_into=is.null" : "") +
              (cursor ? "&id=gt." + cursor : ""),
            null,
            { headers, tags: { name: "snapshot_" + table }, timeout: "20s" },
          ]),
        );
        const next = [];
        responses.forEach((response, index) => {
          if (checked(response, "snapshot_" + pending[index].table)) {
            const rows = response.json();
            if (rows.length === 500)
              next.push({ table: pending[index].table, cursor: rows[499].id });
          }
        });
        pending = next;
      }
      applicationErrors.add(pending.length > 0);
      previousRevision = current;
    }
  }
  // Optional public catalogue traffic. Shared-IP rate limits remain
  // enabled: use distributed generators for public-visitor capacity testing.
  if (Math.random() < Number(__ENV.LOAD_PUBLIC_FRACTION || 0))
    checked(
      http.post(
        api + "/functions/v1/booking",
        JSON.stringify({ action: "booking_page", args: { p_slug: user.slug } }),
        {
          headers: { apikey: key, "Content-Type": "application/json" },
          tags: { name: "public_catalog" },
          timeout: "15s",
        },
      ),
      "catalogue",
    );
  sleep(55 + Math.random() * 10);
}
