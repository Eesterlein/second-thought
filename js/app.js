import { nextReflection, summarize, writingQuestions, SafetyRefusal } from "./ai.js";
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
    const { data, raw } = await nextReflection(session.history, { close });
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
    const data = await writingQuestions(opening);
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
