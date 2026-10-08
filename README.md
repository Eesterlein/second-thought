# Second Thought

A reflective journal with a gentle AI guide. Write down what's on your mind, then either reflect with a guide that asks a few thoughtful questions, or answer the questions in your own words. Every entry is saved to a dated notebook.

See [PLAN.md](PLAN.md) for the roadmap and business model.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000, go to **Settings**, and paste a Claude API key from console.anthropic.com.

## How it's built

- Plain HTML, CSS and JavaScript with no build step, so it can be hosted on GitHub Pages
- `js/prompts.js`: the guide's instructions and tone (the part to tune most)
- `js/ai.js`: Claude API calls (Claude Haiku 5.5)
- `js/storage.js`: entries saved in the browser (localStorage), plus export/import
- `js/app.js`: screens and flow

> This prototype calls the API from the browser with your own key. Before sharing it publicly, move the API calls behind a small backend so the key stays private.

Second Thought is a journal, not therapy. If you're in crisis in the US, call or text 988.
