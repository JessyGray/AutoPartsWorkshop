import { readFile } from "node:fs/promises";
import path from "node:path";

// Called daily by Vercel Cron (vercel.json). Free Supabase projects pause after
// 7 idle days; one query a day keeps it awake even if nobody uses the app.
export default async function handler(req, res) {
  const config = await readFile(path.join(process.cwd(), "web/js/cloud-config.js"), "utf8");
  const url = config.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  const key = config.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  if (!url || !key) return res.status(500).json({ ok: false, error: "Supabase config not found" });

  const response = await fetch(`${url}/rest/v1/workshop_states?select=owner_id&limit=1`, { headers: { apikey: key } });
  const body = await response.text();
  // anon cannot read this table, so Postgres answers "permission denied" (42501): that still counts as activity.
  const ok = response.ok || ((response.status === 401 || response.status === 403) && body.includes('"42501"'));
  res.status(ok ? 200 : 502).json({ ok, status: response.status });
}
