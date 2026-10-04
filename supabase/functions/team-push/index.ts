// team-push — sends the operator a Web Push when a representative adds a client.
// Called only by the `team_leads_notify` trigger (pg_net), which passes the lead
// id and the shared `x-hook-secret` from team_config. Deployed with
// verify_jwt = false because the caller is the database, not a signed-in user;
// the hook secret is the authentication. Reads everything else with the service
// role (provided to Edge Functions automatically), so no secret lives in code.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await sb.from("team_config").select("key,value")
    .in("key", ["vapid_public", "vapid_private", "push_hook_secret"]);
  const c: Record<string, string> = Object.fromEntries((cfg ?? []).map((r) => [r.key, r.value]));
  if (!c.push_hook_secret || req.headers.get("x-hook-secret") !== c.push_hook_secret) {
    return new Response("forbidden", { status: 403 });
  }

  const { lead_id } = await req.json().catch(() => ({}));
  if (!lead_id) return new Response("lead", { status: 400 });
  const { data: l } = await sb.from("team_leads")
    .select("client_name,company,status,member_id").eq("id", lead_id).single();
  if (!l) return new Response("not found", { status: 404 });
  const { data: m } = await sb.from("team_members").select("full_name").eq("id", l.member_id).single();

  const who = m?.full_name ?? "ممثل مبيعات";
  const client = l.company ? `${l.client_name} — ${l.company}` : l.client_name;
  const payload = JSON.stringify({
    title: l.status === "duplicate" ? "عميل مكرر سُجّل" : "عميل محتمل جديد",
    body: `${who} أضاف: ${client}`,
    url: "/team#/admin",
    tag: `lead-${lead_id}`,
  });

  webpush.setVapidDetails("mailto:noreply@rafd-digital.com", c.vapid_public, c.vapid_private);
  const { data: subs } = await sb.from("team_push_subs").select("endpoint,p256dh,auth");
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // the phone unsubscribed or the app was removed: forget it
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("team_push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
