// SecureWorks — GHL Conversation Stats v3 (with audit summary fields)
//
// POST /functions/v1/ghl-conversation-stats
//   body: { contact_ids: string[] }
// Returns per-contact: counts + first/last message snippets + signal flags.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const GHL_TOKEN = Deno.env.get("GHL_API_TOKEN") || "";
const GHL_LOCATION_ID = Deno.env.get("GHL_LOCATION_ID") || "13yKADzN94BRxX4hByYX";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function ghlFetch(path: string) {
  const r = await fetch(`${GHL_API}${path}`, {
    headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  if (!r.ok) return { ok: false as const, status: r.status, body: null };
  const body = await r.json().catch(() => null);
  return { ok: true as const, status: r.status, body };
}

const OPTOUT_RX = /\b(stop|unsubscribe|do not contact|don'?t contact|remove me|take me off|not interested)\b/i;
const COMPLAINT_RX = /\b(disappointed|unhappy|complain|frustrated|cancel|refund|terrible|disgusting)\b/i;
const PARKED_RX = /\b(next (month|year)|later in the year|not yet|still thinking|not now|2027|wife wants)\b/i;

function snip(s: string, n = 280) {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length <= n ? trimmed : trimmed.slice(0, n) + "…";
}

async function statsForContact(contactId: string) {
  const search = await ghlFetch(
    `/conversations/search?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&limit=10`
  );
  if (!search.ok) return { contact_id: contactId, error: `search_${search.status}` };
  const convos = (search.body?.conversations as any[]) || [];
  if (convos.length === 0) {
    return { contact_id: contactId, conversation_id: null, sms_count: 0, call_count: 0,
             inbound_sms: 0, outbound_sms: 0, completed_calls: 0, last_msg_at: null, last_inbound_at: null,
             first_inbound_sms: null, last_inbound_sms: null, last_outbound_sms: null,
             has_optout: false, has_complaint: false, has_parking: false };
  }
  const conversation_id = convos[0].id;
  const list = await ghlFetch(`/conversations/${conversation_id}/messages?limit=100`);
  if (!list.ok) return { contact_id: contactId, conversation_id, error: `list_${list.status}` };

  const inner = list.body?.messages || list.body;
  const messages: any[] = Array.isArray(inner) ? inner : (inner?.messages || []);

  let sms = 0, calls = 0, inboundSms = 0, outboundSms = 0, completedCalls = 0;
  let lastMsgAt: string | null = null, lastInboundAt: string | null = null;
  let firstInboundSms: { body: string; ts: string } | null = null;
  let lastInboundSms: { body: string; ts: string } | null = null;
  let lastOutboundSms: { body: string; ts: string } | null = null;
  let hasOptout = false, hasComplaint = false, hasParking = false;

  // GHL returns messages newest-first by default; sort ascending by ts to find first/last reliably.
  messages.sort((a, b) => (a.dateAdded || "").localeCompare(b.dateAdded || ""));

  for (const m of messages) {
    const t = m.type === "TYPE_CALL" || m.messageType === "TYPE_CALL" ? "call" :
              m.type === "TYPE_SMS" || m.messageType === "TYPE_SMS"  ? "sms"  : "other";
    const ts: string = m.dateAdded || m.timestamp || "";
    const bodyRaw: string = m.body || "";
    if (ts && (!lastMsgAt || ts > lastMsgAt)) lastMsgAt = ts;
    if (t === "sms") {
      sms++;
      if (m.direction === "inbound") {
        inboundSms++;
        if (ts && (!lastInboundAt || ts > lastInboundAt)) lastInboundAt = ts;
        if (bodyRaw.trim()) {
          if (!firstInboundSms) firstInboundSms = { body: snip(bodyRaw), ts };
          lastInboundSms = { body: snip(bodyRaw), ts };
          if (OPTOUT_RX.test(bodyRaw)) hasOptout = true;
          if (COMPLAINT_RX.test(bodyRaw)) hasComplaint = true;
          if (PARKED_RX.test(bodyRaw)) hasParking = true;
        }
      } else {
        outboundSms++;
        if (bodyRaw.trim()) lastOutboundSms = { body: snip(bodyRaw), ts };
      }
    } else if (t === "call") {
      calls++;
      const status = m?.meta?.call?.status || m?.status;
      const duration = m?.meta?.call?.duration ?? 0;
      if (status === "completed" && duration > 0) completedCalls++;
    }
  }

  return {
    contact_id: contactId,
    conversation_id,
    sms_count: sms,
    inbound_sms: inboundSms,
    outbound_sms: outboundSms,
    call_count: calls,
    completed_calls: completedCalls,
    last_msg_at: lastMsgAt,
    last_inbound_at: lastInboundAt,
    first_inbound_sms: firstInboundSms,
    last_inbound_sms: lastInboundSms,
    last_outbound_sms: lastOutboundSms,
    has_optout: hasOptout,
    has_complaint: hasComplaint,
    has_parking: hasParking,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!GHL_TOKEN) return json({ error: "GHL_API_TOKEN not set" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const ids: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : [];
  if (ids.length === 0) return json({ error: "contact_ids array required" }, 400);
  if (ids.length > 200) return json({ error: "max 200 contact_ids per request" }, 400);

  // Throttle: 3 parallel × 600ms inter-chunk pause to avoid 429s.
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    const chunk = ids.slice(i, i + 3);
    const out = await Promise.all(chunk.map((id) => statsForContact(id)));
    results.push(...out);
    if (i + 3 < ids.length) await new Promise((r) => setTimeout(r, 600));
  }

  const summary = {
    total: results.length,
    with_any_sms: results.filter((r) => (r.sms_count || 0) > 0).length,
    with_inbound_sms: results.filter((r) => (r.inbound_sms || 0) > 0).length,
    with_completed_call: results.filter((r) => (r.completed_calls || 0) > 0).length,
    truly_empty: results.filter((r) => !r.sms_count && !r.call_count).length,
    has_optout: results.filter((r) => r.has_optout).length,
    has_complaint: results.filter((r) => r.has_complaint).length,
    has_parking: results.filter((r) => r.has_parking).length,
    errors: results.filter((r) => r.error).length,
  };
  return json({ summary, results });
});
