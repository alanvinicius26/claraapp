// Manual browser regression: all API calls are mocked; never imported by the app.
if (location.hostname !== "127.0.0.1") throw new Error("Local fixture only");
const mode = new URL(location.href).searchParams.get("mode") || "fixed";
const counts = { billing: 0, rpc: 0 };
const started = Date.now();
const result = document.querySelector("#result");
function report() {
  result.textContent = JSON.stringify({ mode, elapsedSeconds: Math.floor((Date.now()-started)/1000), ...counts });
}
window.fetch = async (input) => {
  if (!String(input).endsWith("/functions/v1/billing")) throw new Error("External network blocked");
  counts.billing++;
  report();
  if (counts.billing > 25) throw new Error("Polling loop detected");
  return new Response(JSON.stringify({configured:true,mode:"test",plans_version:2}));
};
const {supabase} = await import("../src/lib.js");
supabase.auth.stopAutoRefresh();
supabase.auth.getSession = async () => ({data:{session:{access_token:"synthetic"}},error:null});
supabase.rpc = async (name) => {
  if(name!=="billing_status") throw new Error("Unexpected RPC");
  counts.rpc++;
  report();
  return {data:{billing_enabled:true,plans_version:2,status:"pending",can_use:true,active_professionals:1,effective_limit:5,trial_ends_at:new Date(Date.now()+86400000).toISOString()},error:null};
};
const React = await import("react");
const {createRoot} = await import("react-dom/client");
const {default:Subscription} = mode === "before"
  ? await import("../.local/stripe/Subscription-before-polling-fix.jsx")
  : await import("../src/Subscription.jsx");
// Deliberately omit professionals, just like the deployed compatibility wrapper.
const root = createRoot(document.querySelector("#root"));
root.render(React.createElement(Subscription,{demo:false,notify:()=>{}}));
const ticker=setInterval(report,1000);
setTimeout(()=>{root.unmount();clearInterval(ticker);report();result.textContent += counts.billing<=3 && counts.rpc<=3 ? " PASS" : " FAIL: repeated requests";},32000);
