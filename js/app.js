import { nextReflection, summarize, writingQuestions, lookBack, SafetyRefusal } from "./ai.js";
import * as store from "./storage.js";
import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

// Words that show the crisis banner immediately, before any AI reply.
const CRISIS_PATTERN =
  /\b(kill (myself|me)|suicid\w*|end (it all|my life)|hurt(ing)? myself|self[- ]?harm\w*|want to die|don'?t want to (live|be here))\b/i;

// ---------- helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children.flat(Infinity)) if (c != null) node.append(c);
  return node;
}

function formatDate(iso, withTime = false) {
  const opts = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
  if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
  return new Date(iso).toLocaleString(undefined, opts);
}

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(iso) {
  return (Date.now() - new Date(iso).getTime()) / DAY;
}

// "yesterday", "on Tuesday", "on Oct 2"
function whenWords(iso) {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / DAY);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `on ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
  return `on ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function timeOfDay(iso) {
  const h = new Date(iso).getHours();
  if (h < 5) return "late night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 23) return "evening";
  return "late night";
}

const FOLLOW_LABELS = { done: "I did it", partly: "Partly", not_yet: "Not yet" };

function followUpText(f) {
  if (!f || !FOLLOW_LABELS[f.status]) return "";
  return FOLLOW_LABELS[f.status] + (f.note ? ` — ${f.note}` : "");
}

// Recent intentions the guide can gently follow up on.
async function recentMemory() {
  try {
    const entries = await store.listEntries();
    return entries
      .filter((e) => e.takeaway && daysAgo(e.createdAt) <= 21)
      .slice(0, 5)
      .map((e) => ({
        date: new Date(e.createdAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        title: e.title || "",
        takeaway: e.takeaway,
        followUp: followUpText(e.followUp),
      }));
  } catch {
    return []; // memory is a bonus; never block a reflection on it
  }
}

let statusTimer;
function status(msg, { sticky = false } = {}) {
  const s = $("status");
  clearTimeout(statusTimer);
  if (!msg) { s.hidden = true; return; }
  s.textContent = msg;
  s.hidden = false;
  if (!sticky) statusTimer = setTimeout(() => (s.hidden = true), 4000);
}

function showCrisis() {
  $("crisis").hidden = false;
  $("crisis").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function checkCrisis(text) {
  if (CRISIS_PATTERN.test(text)) showCrisis();
}

function show(view) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === "notebook") renderNotebook();
  if (view === "home") renderCheckIn();
  if (view === "lookback") renderLookback();
  window.scrollTo(0, 0);
}

function handleError(err) {
  if (err instanceof SafetyRefusal) {
    showCrisis();
    status("Let's pause the reflection here. Please see the resources above.");
  } else {
    status(err.message || "Something went wrong.");
    console.error(err);
  }
}

// ---------- reflect mode ----------

let session = null; // { id, createdAt, opening, history, transcript, closed, summaryPromise }

function addBubble(role, text) {
  const b = el("div", { className: `bubble ${role}`, textContent: text });
  $("chat").append(b);
  b.scrollIntoView({ behavior: "smooth", block: "end" });
  return b;
}

async function guideTurn({ close = false } = {}) {
  const thinking = addBubble("guide thinking", "…");
  setReplyEnabled(false);
  try {
    const { data, raw } = await nextReflection(session.history, { close, recent: session.recent });
    thinking.remove();
    session.history.push({ role: "assistant", content: raw });
    session.transcript.push({ role: "guide", text: data.reply, closing: data.is_closing });
    addBubble("guide", data.reply);
    if (data.safety_concern) showCrisis();
    if (data.is_closing) endSession();
    return true;
  } catch (err) {
    thinking.remove();
    handleError(err);
    return false;
  } finally {
    setReplyEnabled(true);
  }
}

function setReplyEnabled(on) {
  $("reply-form").querySelectorAll("button, textarea").forEach((n) => (n.disabled = !on));
  if (on && !$("reply-form").hidden) $("reply").focus();
}

async function sendUser(text, { close = false } = {}) {
  checkCrisis(text);
  session.history.push({ role: "user", content: text });
  session.transcript.push({ role: "user", text });
  const bubble = addBubble("user", text);
  const ok = await guideTurn({ close });
  if (!ok) {
    // Drop the unanswered turn so the person can try again.
    session.history.pop();
    session.transcript.pop();
    bubble.remove();
    if (session.history.length === 0) show("home"); // opening failed; text is still in the box
    else if (!close) $("reply").value = text;
  }
}

function endSession() {
  session.closed = true;
  $("reply-form").hidden = true;
  $("reflect-done").hidden = false;
  session.summaryPromise = summarize(session.transcript);
  session.summaryPromise.catch(() => {}); // handled when saving
}

async function startReflect() {
  const opening = $("opening").value.trim();
  if (!opening) return $("opening").focus();
  session = {
    id: store.newId(),
    createdAt: new Date().toISOString(),
    opening,
    history: [],
    transcript: [],
    closed: false,
    recent: await recentMemory(),
  };
  $("chat").replaceChildren();
  $("reply-form").hidden = false;
  $("reflect-done").hidden = true;
  $("reflect-date").textContent = formatDate(session.createdAt);
  show("reflect");
  await sendUser(opening);
}

async function reflectionEntry() {
  status("Writing your notebook entry…", { sticky: true });
  const summary = await session.summaryPromise;
  status("");
  return {
    id: session.id,
    createdAt: session.createdAt,
    mode: "reflect",
    opening: session.opening,
    title: summary.title,
    feelings: summary.feelings,
    bullets: summary.bullets,
    takeaway: summary.takeaway,
    transcript: session.transcript.map(({ role, text }) => ({ role, text })),
  };
}

async function saveReflection() {
  try {
    const entry = await reflectionEntry();
    await store.saveEntry(entry);
    $("opening").value = "";
    openEntry(entry.id);
  } catch (err) {
    handleError(err);
  }
}

// ---------- write mode ----------

let draft = null; // entry being written in own words

function renderWrite() {
  $("write-date").textContent = formatDate(draft.createdAt);
  $("write-title").textContent = draft.title || "Your reflection";
  $("write-opening").textContent = draft.opening;
  const wrap = $("write-questions");
  wrap.replaceChildren();
  draft.questions.forEach((q, i) => {
    const id = `wq-${i}`;
    wrap.append(
      el("label", { className: "question", htmlFor: id, textContent: q.q }),
      el("textarea", { id, className: "paper", rows: 4, value: q.a || "" }),
    );
  });
  $("write-free").value = draft.freeText || "";
  $("write-takeaway").value = draft.takeaway || "";
  show("write");
  wrap.querySelector("textarea")?.focus();
}

async function startWrite() {
  const opening = $("opening").value.trim();
  if (!opening) return $("opening").focus();
  checkCrisis(opening);
  const btn = $("start-write");
  btn.disabled = true;
  status("Finding some questions for you…", { sticky: true });
  try {
    const data = await writingQuestions(opening, await recentMemory());
    status("");
    if (data.safety_concern) {
      showCrisis();
      status(data.safety_message);
    }
    draft = {
      id: store.newId(),
      createdAt: new Date().toISOString(),
      mode: "write",
      opening,
      title: data.title,
      questions: data.questions.map((q) => ({ q, a: "" })),
    };
    renderWrite();
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
}

// After a guided reflection: answer the guide's questions in your own words.
async function journalIt() {
  try {
    const entry = await reflectionEntry();
    draft = {
      ...entry,
      questions: session.transcript
        .filter((t) => t.role === "guide" && !t.closing)
        .map((t) => ({ q: t.text, a: "" })),
    };
    renderWrite();
  } catch (err) {
    handleError(err);
  }
}

async function saveWrite() {
  draft.questions = draft.questions.map((q, i) => ({ q: q.q, a: $(`wq-${i}`).value.trim() }));
  draft.freeText = $("write-free").value.trim();
  draft.takeaway = $("write-takeaway").value.trim();
  const written = [...draft.questions.map((q) => q.a), draft.freeText].join(" ");
  checkCrisis(written);
  if (!written.trim()) return status("Write a little something first.");
  try {
    await store.saveEntry(draft);
    $("opening").value = "";
    openEntry(draft.id);
  } catch (err) {
    handleError(err);
  }
}

// ---------- notebook ----------

async function renderNotebook() {
  let entries;
  try {
    entries = await store.listEntries();
  } catch (err) {
    return handleError(err);
  }
  $("empty").hidden = entries.length > 0;
  $("entries").replaceChildren(
    ...entries.map((e) =>
      el("li", {},
        el("button", { onclick: () => openEntry(e.id) },
          el("span", { className: "title", textContent: e.title || e.opening }),
          el("span", {
            className: "meta",
            textContent: `${formatDate(e.createdAt)} · ${e.mode === "reflect" ? "Guided" : "Written"}`
              + (e.feelings?.length ? ` · ${e.feelings.join(", ")}` : ""),
          }),
        ),
      ),
    ),
  );
}

let currentEntryId = null;

async function openEntry(id) {
  const e = await store.getEntry(id).catch(handleError);
  if (!e) return show("notebook");
  currentEntryId = id;
  const answered = (e.questions || []).filter((q) => q.a);
  $("entry").replaceChildren(...[
    el("p", { className: "date", textContent: formatDate(e.createdAt, true) }),
    el("h1", { textContent: e.title || "Reflection" }),
    e.feelings?.length
      ? el("div", { className: "tags" }, e.feelings.map((f) => el("span", { className: "tag", textContent: f })))
      : null,
    el("blockquote", { className: "opening", textContent: e.opening }),
    e.bullets?.length ? el("ul", {}, e.bullets.map((b) => el("li", { textContent: b }))) : null,
    e.takeaway ? el("p", { className: "takeaway", textContent: e.takeaway }) : null,
    e.followUp && FOLLOW_LABELS[e.followUp.status]
      ? el("p", { className: "follow", textContent: `Follow-up ${whenWords(e.followUp.at)}: ${followUpText(e.followUp)}` })
      : null,
    answered.length || e.freeText ? el("h2", { textContent: "In my own words" }) : null,
    answered.map((q) => [
      el("p", { className: "question", textContent: q.q }),
      el("p", { className: "answer", textContent: q.a }),
    ]),
    e.freeText ? el("p", { className: "answer", textContent: e.freeText }) : null,
    e.transcript?.length
      ? el("details", {},
          el("summary", { textContent: "Full conversation" }),
          e.transcript.map((t) =>
            el("p", {}, el("strong", { textContent: t.role === "user" ? "Me: " : "Guide: " }), t.text)),
        )
      : null,
  ].flat(Infinity).filter(Boolean));
  show("entry");
}

async function deleteCurrent() {
  if (!currentEntryId) return;
  const btn = $("delete-entry");
  // Two-step confirm without a browser dialog.
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Tap again to delete";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "Delete entry"; }, 4000);
    return;
  }
  try {
    await store.deleteEntry(currentEntryId);
  } catch (err) {
    return handleError(err);
  }
  btn.dataset.armed = "";
  btn.textContent = "Delete entry";
  show("notebook");
}

// ---------- check-in on a past intention ----------

let checkinEntry = null;
let checkinStatus = null;

async function renderCheckIn() {
  $("checkin").hidden = true;
  let entries;
  try {
    entries = await store.listEntries();
  } catch {
    return;
  }
  // The newest intention that's at least a few hours old, not too stale,
  // and hasn't been checked in on yet.
  checkinEntry = entries.find((e) =>
    e.takeaway && !e.followUp && daysAgo(e.createdAt) >= 0.25 && daysAgo(e.createdAt) <= 14);
  if (!checkinEntry) return;
  checkinStatus = null;
  $("checkin-when").textContent = `${whenWords(checkinEntry.createdAt)[0].toUpperCase()}${whenWords(checkinEntry.createdAt).slice(1)}, you wrote:`;
  $("checkin-takeaway").textContent = checkinEntry.takeaway;
  $("checkin-note").value = "";
  $("checkin-more").hidden = true;
  document.querySelectorAll("[data-follow]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("checkin").hidden = false;
}

async function saveCheckIn(outcome) {
  if (!checkinEntry) return;
  const entry = {
    ...checkinEntry,
    followUp: { status: outcome, note: $("checkin-note").value.trim(), at: new Date().toISOString() },
  };
  try {
    await store.saveEntry(entry);
    $("checkin").hidden = true;
    if (outcome !== "skipped") status("Noted. Thanks for checking in.");
  } catch (err) {
    handleError(err);
  }
}

// ---------- look back ----------

let lookbackDays = 7;

async function periodEntries() {
  const entries = await store.listEntries();
  return entries.filter((e) => daysAgo(e.createdAt) <= lookbackDays);
}

function stat(num, label) {
  return el("div", { className: "stat" },
    el("span", { className: "num", textContent: String(num) }),
    el("span", { className: "label", textContent: label }));
}

async function renderLookback() {
  document.querySelectorAll("[data-period]").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.period) === lookbackDays)));
  $("lookback-insight").replaceChildren();
  let entries;
  try {
    entries = await periodEntries();
  } catch (err) {
    return handleError(err);
  }
  $("lookback-ai").hidden = entries.length === 0;
  if (!entries.length) {
    $("lookback-stats").replaceChildren(
      el("p", { className: "muted", textContent: "No entries in this stretch yet. Patterns will show up here as you write." }));
    return;
  }

  const count = (list) => {
    const m = new Map();
    for (const x of list) m.set(x, (m.get(x) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const feelings = count(entries.flatMap((e) => (e.feelings || []).map((f) => f.toLowerCase())));
  const times = count(entries.map((e) => timeOfDay(e.createdAt)));
  const intentions = entries.filter((e) => e.takeaway);
  const followed = intentions.filter((e) => ["done", "partly"].includes(e.followUp?.status));

  $("lookback-stats").replaceChildren(
    el("div", { className: "stats" },
      stat(entries.length, entries.length === 1 ? "entry" : "entries"),
      stat(times[0][0], "when you write most"),
      intentions.length ? stat(`${followed.length} of ${intentions.length}`, "intentions followed through") : null,
    ),
    feelings.length
      ? el("div", {},
          el("p", { className: "fineprint", textContent: "Feelings that came up" }),
          el("div", { className: "tags" },
            feelings.slice(0, 8).map(([f, n]) => el("span", { className: "tag", textContent: n > 1 ? `${f} ×${n}` : f }))))
      : null,
  );
}

async function runLookback() {
  const btn = $("lookback-ai");
  btn.disabled = true;
  status("Reading back through your entries…", { sticky: true });
  try {
    const entries = (await periodEntries()).slice(0, 40).reverse(); // oldest first
    const data = await lookBack(entries.map((e) => ({
      date: new Date(e.createdAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      timeOfDay: timeOfDay(e.createdAt),
      title: e.title,
      feelings: e.feelings || [],
      opening: e.opening,
      notes: [
        ...(e.bullets || []),
        ...(e.questions || []).filter((q) => q.a).map((q) => q.a),
        e.freeText || "",
      ].join(" ").slice(0, 1200),
      takeaway: e.takeaway || "",
      followUp: followUpText(e.followUp),
    })), lookbackDays === 7 ? "the past week" : "the past month");
    status("");
    $("lookback-insight").replaceChildren(
      el("div", { className: "insight" },
        el("ul", {}, data.observations.map((o) => el("li", { textContent: o }))),
        el("p", { textContent: data.bright_spot }),
        el("p", { className: "question", textContent: data.question }),
        el("button", {
          className: "link",
          textContent: "Write about this",
          onclick: () => {
            $("opening").value = data.question + "\n\n";
            show("home");
            $("opening").focus();
          },
        }),
      ),
    );
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
}

// ---------- daily reminder (calendar file) ----------

function addReminder() {
  const [h, m] = ($("reminder-time").value || "20:30").split(":").map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  const local = (d) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const end = new Date(start.getTime() + 10 * 60 * 1000);
  const url = location.origin + location.pathname;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Second Thought//Daily reminder//EN",
    "BEGIN:VEVENT",
    `UID:${store.newId()}@second-thought`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    "RRULE:FREQ=DAILY",
    "SUMMARY:Second Thought",
    `DESCRIPTION:A few minutes to reflect on your day. ${url}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Time for a second thought",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const a = el("a", {
    href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })),
    download: "second-thought-reminder.ics",
  });
  a.click();
  URL.revokeObjectURL(a.href);
  $("settings-msg").textContent = "Open the downloaded file to add the reminder to your calendar.";
}

// ---------- settings ----------

async function exportEntries() {
  let json;
  try {
    json = await store.exportEntries();
  } catch (err) {
    return handleError(err);
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `second-thought-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importEntries(file) {
  try {
    const n = await store.importEntries(await file.text());
    $("settings-msg").textContent = `Imported ${n} entries.`;
  } catch (err) {
    $("settings-msg").textContent = err.message;
  }
}

// ---------- wiring ----------

$("today").textContent = formatDate(new Date().toISOString());
document.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => show(b.dataset.nav)));
$("crisis-close").onclick = () => ($("crisis").hidden = true);

$("start-reflect").onclick = startReflect;
$("start-write").onclick = startWrite;
$("reply-form").onsubmit = (ev) => {
  ev.preventDefault();
  const text = $("reply").value.trim();
  if (!text || session?.closed) return;
  $("reply").value = "";
  sendUser(text);
};
$("reply").onkeydown = (ev) => {
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) $("reply-form").requestSubmit();
};
$("finish").onclick = () => {
  if (!session || session.closed) return;
  // Close via a user turn so the closing note always follows a user message.
  sendUser("I think that's all for today.", { close: true });
};
$("save-reflection").onclick = saveReflection;
$("journal-it").onclick = journalIt;
$("save-write").onclick = saveWrite;
$("delete-entry").onclick = deleteCurrent;

$("export").onclick = exportEntries;
$("reminder-add").onclick = addReminder;

document.querySelectorAll("[data-follow]").forEach((b) => {
  b.onclick = () => {
    checkinStatus = b.dataset.follow;
    document.querySelectorAll("[data-follow]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("checkin-more").hidden = false;
    $("checkin-note").focus();
  };
});
$("checkin-save").onclick = () => checkinStatus && saveCheckIn(checkinStatus);
$("checkin-skip").onclick = () => saveCheckIn("skipped");

document.querySelectorAll("[data-period]").forEach((b) => {
  b.onclick = () => {
    lookbackDays = Number(b.dataset.period);
    renderLookback();
  };
});
$("lookback-ai").onclick = runLookback;
$("import").onchange = (ev) => ev.target.files[0] && importEntries(ev.target.files[0]);

// ---------- accounts ----------

let authMode = "signin"; // signin | signup | forgot | reset

function setAuthMode(mode) {
  authMode = mode;
  const copy = {
    signin: ["Welcome to Second Thought", "A quiet place to reflect on what's on your mind.", "Sign in", "New here? Create an account"],
    signup: ["Create your account", "Your entries are private to you.", "Create account", "Already have an account? Sign in"],
    forgot: ["Reset your password", "We'll email you a link to set a new one.", "Send reset link", "Back to sign in"],
    reset: ["Choose a new password", "At least 8 characters.", "Save new password", "Back to sign in"],
  }[mode];
  [$("auth-title").textContent, $("auth-intro").textContent, $("auth-submit").textContent, $("auth-switch").textContent] = copy;
  const needsEmail = mode !== "reset";
  const needsPassword = mode !== "forgot";
  $("auth-email").hidden = $("auth-email-label").hidden = !needsEmail;
  $("auth-email").required = needsEmail;
  $("auth-password").hidden = $("auth-password-label").hidden = !needsPassword;
  $("auth-password").required = needsPassword;
  $("auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("auth-forgot").hidden = mode !== "signin";
  $("auth-msg").textContent = "";
  show("auth");
}

async function submitAuth(ev) {
  ev.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const btn = $("auth-submit");
  btn.disabled = true;
  $("auth-msg").textContent = "";
  try {
    let result;
    if (authMode === "signin") {
      result = await supabase.auth.signInWithPassword({ email, password });
    } else if (authMode === "signup") {
      result = await supabase.auth.signUp({
        email, password, options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (!result.error && !result.data.session) {
        $("auth-msg").textContent = "Almost there! Check your email for a link to confirm your account.";
      }
    } else if (authMode === "forgot") {
      result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (!result.error) $("auth-msg").textContent = "If that email has an account, a reset link is on its way.";
    } else {
      result = await supabase.auth.updateUser({ password });
      if (!result.error) {
        recovering = false;
        history.replaceState(null, "", location.pathname);
        status("Password updated.");
        show("home");
      }
    }
    if (result.error) $("auth-msg").textContent = result.error.message;
  } finally {
    btn.disabled = false;
  }
}

$("auth-form").onsubmit = submitAuth;
$("auth-switch").onclick = () => setAuthMode(authMode === "signin" ? "signup" : "signin");
$("auth-forgot").onclick = () => setAuthMode("forgot");
$("sign-out").onclick = () => supabase.auth.signOut();

let signedInUser; // undefined until the first auth event
// Reset-password links sign the person in; keep them on the new-password form.
let recovering = /type=recovery/.test(location.hash);

supabase.auth.onAuthStateChange((event, authSession) => {
  const user = authSession?.user ?? null;
  $("nav").hidden = !user;
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (recovering) {
    signedInUser = user;
    return setAuthMode("reset");
  }
  if (signedInUser !== undefined && user?.id === signedInUser?.id) return;
  signedInUser = user;
  store.clearCache();
  session = draft = null;
  if (user) {
    $("signed-in-as").textContent = user.email;
    $("auth-password").value = "";
    show("home");
  } else {
    setAuthMode("signin");
  }
});
