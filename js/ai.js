// Talks to the "guide" server function, which holds the Claude API key
// and the prompts. The app never sees the key.
import { FunctionsHttpError } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { supabase } from "./supabase.js";

export class SafetyRefusal extends Error {}

async function callGuide(body) {
  const { data, error } = await supabase.functions.invoke("guide", { body });
  if (error) {
    let message = "Couldn't reach the guide. Check your connection and try again.";
    if (error instanceof FunctionsHttpError) {
      try {
        message = (await error.context.json()).error || message;
      } catch { /* keep the default message */ }
    }
    throw new Error(message);
  }
  if (data.refusal) throw new SafetyRefusal();
  return data;
}

// history: [{ role: "user" | "assistant", content: string }]
// Assistant turns hold the raw JSON text Claude returned. The server wraps
// up the reflection on its own after enough questions, or when close is set.
export function nextReflection(history, { close = false } = {}) {
  return callGuide({ kind: "reflect", history, close });
}

export async function summarize(transcript) {
  const { data } = await callGuide({
    kind: "summary",
    transcript: transcript.map(({ role, text }) => ({ role, text })),
  });
  return data;
}

export async function writingQuestions(opening) {
  const { data } = await callGuide({ kind: "write", opening });
  return data;
}
