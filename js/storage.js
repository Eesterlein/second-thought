// Entries are saved to the signed-in user's account in Supabase.
// Database rules make sure each person can only ever see their own.
import { supabase } from "./supabase.js";

let cache = null; // newest-first list of entries for this session

function fail(error) {
  console.error(error);
  throw new Error("Couldn't reach your notebook. Check your connection and try again.");
}

export async function listEntries({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  const { data, error } = await supabase
    .from("entries")
    .select("data")
    .order("created_at", { ascending: false });
  if (error) fail(error);
  cache = data.map((row) => row.data);
  return cache;
}

export async function getEntry(id) {
  return (await listEntries()).find((e) => e.id === id);
}

export async function saveEntry(entry) {
  const { error } = await supabase
    .from("entries")
    .upsert({ id: entry.id, created_at: entry.createdAt, data: entry });
  if (error) fail(error);
  if (cache) cache = [entry, ...cache.filter((e) => e.id !== entry.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteEntry(id) {
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) fail(error);
  if (cache) cache = cache.filter((e) => e.id !== id);
}

export function clearCache() {
  cache = null;
}

export async function exportEntries() {
  const entries = await listEntries({ refresh: true });
  return JSON.stringify({ app: "second-thought", version: 1, entries }, null, 2);
}

// Merges imported entries; entries with the same id are replaced.
export async function importEntries(json) {
  const parsed = JSON.parse(json);
  const incoming = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(incoming)) throw new Error("That file doesn't look like a Second Thought export.");
  const valid = incoming.filter((e) => e && e.id && e.createdAt);
  const { error } = await supabase
    .from("entries")
    .upsert(valid.map((e) => ({ id: e.id, created_at: e.createdAt, data: e })));
  if (error) fail(error);
  cache = null;
  return valid.length;
}

export function newId() {
  return crypto.randomUUID();
}
