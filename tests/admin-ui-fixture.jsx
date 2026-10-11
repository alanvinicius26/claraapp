// Local visual/interaction fixture only. Never imports production main or real credentials.
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "../src/redesign.css";
import "../src/brand.css";
const mode = new URL(location.href).searchParams.get("mode");
const owner = "22222222-2222-4222-8222-222222222222";
let benefit = null,
  events = [],
  coupons = [];
const session = {
  access_token: "synthetic",
  user: { id: "11111111-1111-4111-8111-111111111111" },
};
const row = () => ({
  owner_id: owner,
  email: "parceira@example.invalid",
  studio_name: "Ateliê de testes",
  team_size: 1,
  plan_id: "solo",
  effective_limit: benefit ? 3 : 1,
  can_use: !!benefit,
  benefit,
  has_open_subscription: false,
  has_pending_operation: false,
});
window.fetch = async (url, init) => {
  if (!String(url).endsWith("/functions/v1/billing"))
    throw new Error("External network disabled");
  const body = JSON.parse(init.body);
  const result = { message: "Alteração simulada com sucesso." };
  if (body.action === "status")
    return Response.json({ configured: true, mode: "test", plans_version: 2 });
  if (body.action === "admin_access_set") {
    benefit = {
      id: crypto.randomUUID(),
      kind: body.args.p_kind,
      plan_id: body.args.p_plan,
      expires_at: body.args.p_expires,
      reason: body.args.p_reason,
    };
    events.unshift({
      id: events.length + 1,
      action: "access_granted",
      created_at: new Date().toISOString(),
      details: { after: benefit },
    });
  }
  if (body.action === "admin_coupon_create")
    coupons.unshift({
      id: crypto.randomUUID(),
      code: body.code,
      definition: body.definition,
      state: "active",
    });
  if (
    body.action === "admin_coupon_inspect" ||
    body.action === "admin_coupon_disable"
  ) {
    const coupon = coupons.find((c) => c.id === body.id);
    if (body.action === "admin_coupon_disable") coupon.state = "inactive";
    result.coupon = { ...coupon, times_redeemed: 0 };
  }
  return Response.json(result);
};
const { supabase } = await import("../src/lib.js");
supabase.auth.stopAutoRefresh();
supabase.auth.getSession = async () => ({ data: { session }, error: null });
supabase.rpc = async (name, args) => {
  let data;
  if (name === "platform_admin_status") data = mode !== "denied";
  else if (mode === "denied") throw new Error("Permission denied");
  else if (name === "admin_accounts")
    data =
      args.p_search && !JSON.stringify(row()).includes(args.p_search)
        ? []
        : [row()];
  else if (name === "admin_history") data = events;
  else if (name === "admin_coupons_list") data = coupons;
  else if (name === "admin_revoke_access") {
    benefit = null;
    data = true;
  } else if (name === "billing_status")
    data = {
      can_use: true,
      benefit: { kind: "courtesy", plan_id: "team3", expires_at: null },
      effective_limit: 3,
      plans_version: 2,
      active_professionals: 1,
      plan_id: "solo",
      billing_enabled: true,
      status: "trial",
    };
  else throw new Error(name);
  return { data, error: null };
};
const { default: Admin } = await import("../src/Admin.jsx");
const { default: Subscription } = await import("../src/Subscription.jsx");
function Fixture() {
  const [message, setMessage] = React.useState("");
  return (
    <>
      {mode === "benefit" ? (
        <div style={{ padding: 24 }}>
          <Subscription notify={setMessage} />
        </div>
      ) : (
        <Admin notify={setMessage} />
      )}
      {message && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 8,
            left: 8,
            padding: 16,
            background: "#fff0c2",
            maxWidth: "90%",
          }}
          onClick={() => setMessage("")}
        >
          {message}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
