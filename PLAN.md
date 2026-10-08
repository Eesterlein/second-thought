# Second Thought — Project Plan

*Started 2026-10-07*

## The idea

A reflective journal guided by AI. The app opens with one question — **"What's on your mind today?"** — and the person answers in a sentence or two ("I yelled at my toddler and now I feel bad", "I was rude to my boss"). From there they choose how to reflect:

- **Reflect with AI** — the AI asks gentle follow-up questions, one at a time, then closes the conversation. The session is saved as a few short bullet points, not a transcript.
- **Write it myself** — the AI writes a few reflection questions, and the person answers them in their own words in the journal.

Every entry is saved with its date, so the notebook becomes a record you can look back on and spot patterns in.

## Principles

1. **Ask, don't advise.** The AI reflects back and asks open questions. No lecturing, judging, diagnosing, or unrequested advice.
2. **The person does the reflecting.** The AI asks the questions; the insight comes from the person's own words.
3. **Short and finite.** About 3–5 questions per session, then a warm close and one small takeaway. No endless chat.
4. **Safety first.** If someone mentions self-harm, harming others, or being in danger, the app stops the reflection and shows crisis resources (988 Suicide & Crisis Lifeline — call or text 988 in the US).
5. **Private by default.** Entries stay on the person's own device unless there's a strong reason to change that.
6. **Not therapy.** The app says this clearly.

## Roadmap

### Phase 1 — Personal prototype (now)
- Static web app (HTML/CSS/JS, no build step), hostable on GitHub Pages
- Claude API called from the browser with the user's own API key, stored in the browser only
- Model: Claude Haiku 5.5 (`claude-haiku-5-5`) — $0.10 / $0.50 per million input/output tokens, so a session costs a small fraction of a cent
- Entries stored in the browser (localStorage)
- Screens: today's prompt → reflect (AI chat or write-it-myself) → notebook by date
- Crisis-resource banner (keyword check in the browser plus a flag from the AI)
- Export/import of entries as JSON, so nothing is trapped in one browser

### Phase 2 — Friends and family
- Small backend (e.g. Cloudflare Worker) holds the API key, so testers don't need one
- Rate limiting per user
- Make it installable on phones (PWA)
- Collect feedback: do people come back? Which mode do they use?

### Phase 3 — Public launch
- Accounts and sync, with encryption, only if needed; otherwise stay on the device
- Payments through Stripe (web)
- Privacy policy, terms of service, "not therapy" disclaimer
- Check health-data privacy laws (e.g. Washington's My Health My Data Act)

### Phase 4 — App stores (if it's taking off)
- Apple ($99/yr; small-business commission 15%) and Google Play ($25 once)

## Business model

**Not a flat $1 per download.** The AI costs money on every use, forever, while a one-time sale pays once. Heavy users would eventually cost more than they paid.

Preferred: **free journaling + paid AI**
- Free: the write-it-myself mode and the notebook
- Paid: AI reflections, about $2–4/month, *or* a one-time purchase that includes a bundle of AI sessions, with more available as an in-app purchase

| Model | Verdict |
|---|---|
| Free + subscription for AI | Best fit; costs scale with revenue |
| One-time purchase + AI credits | Good; closest to the original idea |
| Bring your own API key | Fine for the prototype, too technical for the public |
| Flat $1, unlimited AI | Avoid |

## To-do before going public
- [ ] Check that the name "Second Thought" is free: App Store, Google Play, USPTO trademark search
- [ ] Privacy policy and terms
- [ ] Review and test the safety/crisis behavior
- [ ] Decide on a pricing model
