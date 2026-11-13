// ══════════════════════════════════════════════════════════════════
// Supabase Edge Function: cliq-notify  (BOT version)
// Posts CRM notifications to Cliq THROUGH THE BOT so messages show the
// bot's name/avatar ("StormShield Pro CRM"), not a person.
//
// Deploy name: cliq-notify   ·   Verify JWT: OFF
//
// Posts to the bot incoming endpoint; the bot's published handler calls
// postToChannelAsBot(channel, bot, text) to post as the bot.
//
// Secrets:
//   CLIQ_WEBHOOK_TOKEN     — the BOT's webhook token
//   CLIQ_BOT_NAME          — stormshieldprocrm
//   CLIQ_CHANNEL_DEFAULT   — general
//   CLIQ_CHANNEL_PAYROLL   — payroll channel unique name
//   CLIQ_CHANNEL_INVOICING — invoices channel unique name
//   CLIQ_CHANNEL_APPRAISAL — optional; appraisal channel unique name. Defaults to
//                            "appraisalpublicadjuster" (appraisal approved / denied)
//   CLIQ_DC                — cliq.zoho.com
//
// A channel key with no secret set falls back to CLIQ_CHANNEL_DEFAULT.
// ══════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("setup") === "ping") {
      const ch = u.searchParams.get("channel") || "";
      const samples = {
        payroll: ["**Final Check Collected — ready for commission**","👤 Betty Hoffman","📍 1247 Sagemark Ridge","👷 Matthew Trinh","💰 Collected $18,450.00 of $18,450.00","➡️ Break down and write commission check"].join("\n"),
        invoicing: ["**Ready to Invoice**","👤 Betty Hoffman","📍 1247 Sagemark Ridge","👷 Matthew Trinh","🏢 State Farm","💵 RCV $16,200.00 + supplement $2,250.00 = $18,450.00","✅ Supplement Approved","➡️ Sync/send the invoice in Zoho"].join("\n"),
        appraisal: ["✅ **Appraisal Approved**","👤 Betty Hoffman","📍 1247 Sagemark Ridge","👷 Matthew Trinh","🏢 State Farm","#️⃣ Claim 12345","➡️ Moved to Overturned / Approved"].join("\n"),
      };
      const sample = samples[ch.toLowerCase()] || ["**Contract Signed**","👤 Betty Hoffman","📍 1247 Sagemark Ridge","👷 Matthew Trinh","💰 $18,450.00"].join("\n");
      const r = await postViaBot(sample, ch);
      return json(r.ok ? { SUCCESS: "Sample sent via bot", channel: r.channel } : { error: r.error, detail: r.detail }, r.ok ? 200 : 500);
    }
    return json({ error: "POST only (or ?setup=ping)" }, 405);
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { content, channel } = await req.json();
    if (!content || !String(content).trim()) return json({ error: "Empty message" }, 400);
    const r = await postViaBot(String(content), String(channel || ""));
    return r.ok ? json({ ok: true, channel: r.channel }) : json({ error: r.error, detail: r.detail }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function postViaBot(content, channelKey) {
  const dc = Deno.env.get("CLIQ_DC") || "cliq.zoho.com";
  const token = Deno.env.get("CLIQ_WEBHOOK_TOKEN") || "";
  const bot = Deno.env.get("CLIQ_BOT_NAME") || "";
  if (!token) return { ok: false, error: "CLIQ_WEBHOOK_TOKEN not set" };
  if (!bot) return { ok: false, error: "CLIQ_BOT_NAME not set" };

  const map = {
    payroll: Deno.env.get("CLIQ_CHANNEL_PAYROLL"),
    invoicing: Deno.env.get("CLIQ_CHANNEL_INVOICING"),
    appraisal: Deno.env.get("CLIQ_CHANNEL_APPRAISAL") || "appraisalpublicadjuster",
  };
  const channelName = (channelKey && map[channelKey.toLowerCase()]) || Deno.env.get("CLIQ_CHANNEL_DEFAULT") || "";
  if (!channelName) return { ok: false, error: "No channel configured (set CLIQ_CHANNEL_DEFAULT)" };

  const text = content.replace(/\*\*(.+?)\*\*/g, "*$1*");
  const url = `https://${dc}/api/v2/bots/${encodeURIComponent(bot)}/incoming?zapikey=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, channel: channelName }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, error: `Cliq bot HTTP ${res.status}`, detail, channel: channelName };
  }
  return { ok: true, channel: channelName };
}
