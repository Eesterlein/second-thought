# Second Thought

A reflective journal with a gentle AI guide. Write down what's on your mind, then either reflect with a guide that asks a few thoughtful questions, or answer the questions in your own words. Every entry is saved to a dated notebook.

See [PLAN.md](PLAN.md) for the roadmap and business model.

## Run it locally

```bash
python3 -m http.server 8000
```

Before the first run, copy `js/config.example.js` to `js/config.js` and fill in your Supabase project URL and publishable key. Then open http://localhost:8000.

## How it's built

- Plain HTML, CSS and JavaScript with no build step, so it can be hosted on GitHub Pages
- `js/app.js`: screens and flow
- `js/storage.js`: entries saved to each user's account (Supabase), plus export/import
- `js/ai.js`: requests to the guide server function
- `supabase/functions/guide/`: the server function that calls Claude (Claude Haiku 5.5); `prompts.ts` holds the guide's tone, the part to tune most
- `supabase/migrations/`: database tables and privacy rules

Accounts and entries live in Supabase. The Claude API key is stored only as a Supabase secret, and each person has a daily limit on AI use. The site is published to GitHub Pages by `.github/workflows/pages.yml`, which adds the Supabase settings from repository secrets.

Second Thought is a journal, not therapy. If you're in crisis in the US, call or text 988.
