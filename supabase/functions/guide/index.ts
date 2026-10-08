// The only place the Claude API key is used. The app sends a reflection
// request; this function checks the user is signed in and under today's
// limit, then calls Claude with the server-side prompts.
import Anthropic from "npm:@anthropic-ai/sdk@0.126.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  MODEL, MAX_QUESTIONS, REFLECT_SYSTEM, REFLECT_SCHEMA, CLOSE_NOTE,
  SUMMARY_SYSTEM, SUMMARY_SCHEMA, WRITE_SYSTEM, WRITE_SCHEMA,
} from "./prompts.ts";

const DAILY_CALL_LIMIT = 60; // roughly 10 reflections a day
const MAX_TEXT = 4000; // characters per message
const MAX_TURNS = 24;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class BadRequest extends Error {}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequest("Missing text.");
  if (value.length > MAX_TEXT) throw new BadRequest("That's a bit long — try trimming it down.");
  return value;
}

async function askJson(
  system: string,
  schema: Record<string, unknown>,
  messages: Anthropic.MessageParam[],
) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
  });
  if (response.stop_reason === "refusal") return { refusal: true };
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Empty reply from Claude.");
  return { data: JSON.parse(block.text), raw: block.text };
}

function reflect(body: { history?: unknown; close?: unknown }) {
  const history = body.history;
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_TURNS) {
    throw new BadRequest("Invalid conversation.");
  }
  const messages: Anthropic.MessageParam[] = history.map((m, i) => {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (m?.role !== role) throw new BadRequest("Invalid conversation.");
    return { role, content: text(m.content) };
  });
  if (messages.at(-1)!.role !== "user") throw new BadRequest("Invalid conversation.");

  const answers = messages.filter((m) => m.role === "user").length - 1; // minus the opening
  if (body.close === true || answers >= MAX_QUESTIONS) {
    // Mid-conversation system message: tells the guide to wrap up.
    messages.push({ role: "system", content: CLOSE_NOTE } as unknown as Anthropic.MessageParam);
  }
  return askJson(REFLECT_SYSTEM, REFLECT_SCHEMA, messages);
}

function summary(body: { transcript?: unknown }) {
  const t = body.transcript;
  if (!Array.isArray(t) || t.length === 0 || t.length > MAX_TURNS + 1) {
    throw new BadRequest("Invalid conversation.");
  }
  const content = t
    .map((m) => `${m?.role === "user" ? "Me" : "Guide"}: ${text(m?.text)}`)
    .join("\n\n");
  return askJson(SUMMARY_SYSTEM, SUMMARY_SCHEMA, [{ role: "user", content }]);
}

function write(body: { opening?: unknown }) {
  return askJson(WRITE_SYSTEM, WRITE_SCHEMA, [{ role: "user", content: text(body.opening) }]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Please sign in again." }, 401);

  const { data: allowed, error } = await admin.rpc("use_ai_call", {
    p_user: auth.user.id,
    p_limit: DAILY_CALL_LIMIT,
  });
  if (error) {
    console.error(error);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
  if (!allowed) {
    return json({ error: "You've reached today's limit for guided reflections. Come back tomorrow, or write it yourself." }, 429);
  }

  try {
    const body = await req.json();
    const handlers = { reflect, summary, write } as const;
    const handler = handlers[body?.kind as keyof typeof handlers];
    if (!handler) throw new BadRequest("Unknown request.");
    return json(await handler(body));
  } catch (err) {
    if (err instanceof BadRequest) return json({ error: err.message }, 400);
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "The guide is busy right now. Wait a moment and try again." }, 503);
    }
    console.error(err);
    return json({ error: "The guide couldn't respond. Try again." }, 502);
  }
});
