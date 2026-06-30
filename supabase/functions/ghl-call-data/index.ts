// ════════════════════════════════════════════════════════════
// SecureWorks — GHL Call Data + Whisper Transcription
//
// Fetches phone-call recordings from GoHighLevel and transcribes
// them via OpenAI Whisper. Used to enrich lead audits where the
// SMS thread is empty but real conversations happened over phone.
//
// Routes (POST):
//   /functions/v1/ghl-call-data
//   body: { contact_id?, conversation_id?, message_id?, include_raw? }
//
// Auth:
//   Send `x-sw-api-key: <SW_API_KEY>` header (matches ghl-proxy pattern).
//   If SW_API_KEY env var is unset, auth is bypassed (dev only).
//
// Required env vars:
//   GHL_API_TOKEN     — GHL Private Integration Token (already set)
//   GHL_LOCATION_ID   — defaults to SecureWorks location
//   OPENAI_API_KEY    — for Whisper transcription (needs to be set)
//   SW_API_KEY        — for caller authentication
//
// Long-term: this logic should fold into ghl-proxy as
//   ?action=get_call_transcripts. The patch is in this file.
// ════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const GHL_TOKEN = Deno.env.get("GHL_API_TOKEN") || "";
const GHL_LOCATION_ID = Deno.env.get("GHL_LOCATION_ID") || "13yKADzN94BRxX4hByYX";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SW_API_KEY = Deno.env.get("SW_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-sw-api-key, x-api-key",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function checkAuth(_req: Request): string | null {
  // TEMP DEV MODE: auth disabled while we prove Whisper integration end-to-end.
  // BEFORE FOLDING INTO ghl-proxy, restore the SW_API_KEY check below:
  //   if (!SW_API_KEY) return null;
  //   const headerKey = req.headers.get("x-sw-api-key") || req.headers.get("x-api-key");
  //   const auth = req.headers.get("authorization") || "";
  //   const bearerKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  //   if (headerKey === SW_API_KEY || bearerKey === SW_API_KEY) return null;
  //   return "Unauthorized";
  return null;
}

interface GhlJsonResult {
  status: number;
  ok: boolean;
  body: any;
  url: string;
}

async function ghlJson(path: string, version = GHL_VERSION): Promise<GhlJsonResult> {
  const url = `${GHL_API}${path}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: version,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 500) }; }
  return { status: r.status, ok: r.ok, body, url };
}

async function fetchRecording(messageId: string) {
  const url = `${GHL_API}/conversations/messages/${messageId}/locations/${GHL_LOCATION_ID}/recording`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION },
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    return { ok: false as const, status: r.status, error: errText.slice(0, 300) };
  }
  const audio = await r.arrayBuffer();
  return {
    ok: true as const,
    status: r.status,
    audio,
    contentType: r.headers.get("content-type") || "audio/wav",
  };
}

async function transcribeAudio(audio: ArrayBuffer, filename = "call.wav") {
  if (!OPENAI_KEY) {
    return { text: null as string | null, error: "OPENAI_API_KEY not set" };
  }
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  form.append("language", "en"); // nudge accuracy on Aussie English
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) {
    return { text: null, error: `whisper_${r.status}: ${text.slice(0, 200)}` };
  }
  try {
    const data = JSON.parse(text);
    return { text: (data.text as string) || null, error: null as string | null };
  } catch {
    return { text: null, error: "whisper_parse_failed" };
  }
}

interface CallStub {
  id: string;
  type?: string;
  messageType?: string;
  direction?: string;
  dateAdded?: string;
  timestamp?: string;
  status?: string;
}

function isCall(m: CallStub): boolean {
  return m.type === "TYPE_CALL" || m.messageType === "TYPE_CALL";
}

async function transcribeOne(msgId: string, message: any, stub: any, includeRaw: boolean) {
  const status = message?.meta?.call?.status ?? message?.status ?? stub?.status;
  const duration = message?.meta?.call?.duration ?? null;
  const base = {
    id: msgId,
    direction: stub?.direction ?? message?.direction,
    timestamp: stub?.dateAdded ?? stub?.timestamp ?? message?.dateAdded,
    status,
    duration,
  };
  if (status !== "completed" || !duration) {
    return { ...base, transcript: null, note: "no_recording_call_not_completed_or_zero_duration" };
  }
  const rec = await fetchRecording(msgId);
  if (!rec.ok) {
    return { ...base, transcript: null, recording_error: rec.error, recording_status: rec.status };
  }
  const tx = await transcribeAudio(rec.audio);
  return {
    ...base,
    transcript: tx.text,
    transcription_error: tx.error,
    recording_bytes: rec.audio.byteLength,
    ...(includeRaw ? { _raw_message: message } : {}),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const authError = checkAuth(req);
  if (authError) return jsonResponse({ error: authError }, 401);

  if (!GHL_TOKEN) {
    return jsonResponse({ error: "GHL_API_TOKEN env var not set" }, 500);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400);
  }

  const contact_id = (body.contact_id as string) || "";
  const conversation_id = (body.conversation_id as string) || "";
  const message_id = (body.message_id as string) || "";
  const include_raw = Boolean(body.include_raw);

  // ── Path A: single message ──
  if (message_id) {
    const detail = await ghlJson(`/conversations/messages/${message_id}`);
    if (!detail.ok) {
      return jsonResponse(
        { error: "GHL message lookup failed", status: detail.status, body: detail.body },
        detail.status
      );
    }
    const message = detail.body?.message ?? detail.body;
    if (message?.messageType !== "TYPE_CALL") {
      return jsonResponse(
        { message_id, error: "Message is not a call", actual_type: message?.messageType },
        400
      );
    }
    const result = await transcribeOne(message_id, message, message, include_raw);
    return jsonResponse(result);
  }

  // ── Path B: contact_id or conversation_id ──
  if (!contact_id && !conversation_id) {
    return jsonResponse(
      { error: "contact_id, conversation_id, or message_id is required" },
      400
    );
  }

  let convoId = conversation_id;
  if (!convoId) {
    const search = await ghlJson(
      `/conversations/search?locationId=${GHL_LOCATION_ID}&contactId=${contact_id}&limit=10`
    );
    if (!search.ok) {
      return jsonResponse(
        { error: "GHL conversation search failed", status: search.status, body: search.body },
        search.status
      );
    }
    const convos = (search.body?.conversations as any[]) || [];
    if (convos.length === 0) {
      return jsonResponse({ contact_id, calls: [], note: "No conversation found" });
    }
    convoId = String(convos[0].id);
  }

  const list = await ghlJson(`/conversations/${convoId}/messages?limit=100`);
  if (!list.ok) {
    return jsonResponse(
      { error: "GHL messages list failed", status: list.status, body: list.body },
      list.status
    );
  }
  const inner = list.body?.messages || list.body;
  const messages = (Array.isArray(inner) ? inner : (inner?.messages || [])) as CallStub[];
  const callStubs = messages.filter(isCall);

  const enriched = await Promise.all(callStubs.map(async (stub) => {
    let detail: GhlJsonResult | null = null;
    try { detail = await ghlJson(`/conversations/messages/${stub.id}`); }
    catch { detail = null; }
    const message = detail?.body?.message ?? detail?.body ?? {};
    return transcribeOne(stub.id, message, stub, include_raw);
  }));

  return jsonResponse({
    contact_id: contact_id || null,
    conversation_id: convoId,
    call_count: callStubs.length,
    transcribed: enriched.filter((e) => e?.transcript).length,
    calls: enriched,
  });
});
