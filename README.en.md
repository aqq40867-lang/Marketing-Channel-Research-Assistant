# Marketing Channel Research Assistant

[简体中文](README.md) | **English**

Enter a product description, target customers and target market. The tool returns up to 3 promotion channels backed by public evidence, plus an English outreach email draft you can edit. Results are saved in the browser and can be reopened at any time.

**Tech stack**: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + zod; DeepSeek API (chat model, Search, Fetch); data stored in browser localStorage; tests with vitest.

## Running

First set up the key (needed for both options):

```bash
cp .env.example .env.local   # Windows: copy .env.example .env.local
# set DEEPSEEK_API_KEY in .env.local
```

**Resources you need to provide**: one DeepSeek API key (shared by the chat model, Search API and Fetch API; pay-as-you-go). All other variables are optional; see `.env.example`.

### Option 1: Run locally (Node.js 20+)

```bash
npm install
npm run dev                  # open http://localhost:3000
```

Without a key, you can try the flow with offline mock data (fictional; domains end in `.example`): in `.env.local` set `DEEPSEEK_API_KEY=mock` and `DEEPSEEK_BASE_URL=http://localhost:8787`, run `npm run mock` in another terminal, then run `npm run dev`.

### Option 2: Docker

Requires Docker Desktop or Docker Engine + Compose.

```bash
docker compose up -d --build # open http://localhost:3000
docker compose down          # stop
```

Without a key: in `.env.local` set `DEEPSEEK_API_KEY=mock` and `DEEPSEEK_BASE_URL=http://mock:8787`, then run `docker compose --profile mock up -d --build`.

Tests: `npm test` (61 tests, no key needed).

## Usage

1. Fill in the product description, target customers and target market (or click the example to fill in the brief's scenario), then click **Start research**. A run takes about 30–60 seconds.
2. Review the channel cards: name, URL, why it fits, quotes and evidence links. Yellow items are unverified. If there are fewer than 3 results, the page explains why and lists the excluded candidates.
3. Click **Write email for this channel** to generate an English draft you can edit directly. Numbers without a source are flagged red, claims about customers, results or partnerships are flagged yellow, and missing information becomes placeholders like `[Your name]`. The tool does not send email.
4. Change the input and run again for new results. In **History** you can reopen, delete or export past runs as Markdown.

## How the brief is covered

| Requirement | Implementation |
| --- | --- |
| A working web page | Form + live progress; change the input to run again |
| Evidence-based channel recommendations | URLs come only from search results; every judgement carries a quote that code matches word for word against the fetched page, and unmatched quotes are marked unverified; fewer channels are recommended when evidence is thin |
| English outreach draft | Only user input and verified evidence are given to the model; code then checks the draft for made-up numbers and overstated claims |
| Results that can be reopened | Stored in browser localStorage; interrupted runs can Resume |
| Clear messages on errors | Missing input, no qualified channels, fetch failures, bad key, insufficient balance, rate limits and save failures each show a message and a suggested next step |

## Design trade-offs

- **localStorage instead of a database**: no deployment or setup, so reviewers can run it straight away. The cost is that data doesn't carry across browsers; storage sits behind an interface and can be replaced later.
- **Fewer but reliable recommendations**: a quote only counts as evidence if it matches the page text word for word, and the market check is strict too. The cost is that some suitable channels are missed, but the brief asks for evidence-based recommendations, and a wrong recommendation costs more than a missing one.
- **Code verification instead of model self-checking**: the model only understands and writes; fact checking is left to deterministic code. The cost is that code can only check whether a sentence exists, so whether it supports the conclusion still needs a person.
- **Model thinking is off by default**: with `deepseek-flash`, thinking counts towards the output length limit, which truncated the JSON and broke the shortlist step during development. With it off, the shortlist step measured about 5× faster (1.9 s vs 10.7 s) with about one-seventh of the output tokens, and the format is stable. The cost is possibly less careful judgement; but evidence is checked word for word by code, so quality doesn't depend on how deeply the model thinks. Set `DEEPSEEK_THINKING=on` to enable it.

## Code review

The AI-generated code was reviewed and fixed against these four checks:

- **APIs checked against official docs**: fixed a retired default model name; a 403/404 from Fetch is no longer treated as a key error that aborts the whole run.
- **Implementation matches its description**: the fact check went from "only checks the source id" to checking every number; the "verified" flag is now signed by the server so it can't be forged.
- **Requirements and error handling**: drafting has an overall time limit and keeps the first draft on timeout; checkpoints carry a version; funnel stats were corrected.
- **Integration tests for high-risk changes**: cover a full run, drafting, resuming from a checkpoint, tampered data and a bad key.

## Known limitations

- Only DeepSeek is supported; other LLM APIs can't be swapped in directly. The chat model uses an OpenAI-compatible endpoint but sends a DeepSeek-specific parameter, and search and page fetching use DeepSeek's own Search/Fetch APIs, which other providers don't offer. To switch, only `src/lib/deepseek.ts` needs changing (point chat at another OpenAI-compatible service, and replace `search()` / `fetchPage()` with e.g. Tavily or Brave Search); the rest of the code is unaffected.
- Search results change over time, so the same input can give different results on two runs.
- Code can only prove "this sentence is on the page", not whether it supports the conclusion or is out of date; that needs a person to check.
- Data lives only in the current browser; switching browsers, clearing site data or using private mode loses it. Capacity is about 5 MB.
- The market check is strict (the page must say so, or the site must use the target country's domain), so some `.com` sites may be missed; sites that refuse fetching can't be recommended.
- No contact email addresses are provided; the interface and emails are English only.

## AI tools, borrowed code and my own work

- **Claude Code**: generated most of the code from my PRD (research pipeline, pages, mock server, tests).
- **DeepSeek API**: used at runtime to understand input, shortlist and judge channels, write emails, and search and fetch web pages.
- **Open-source dependencies**: Next.js, React, Tailwind CSS, zod, vitest; no third-party business logic was copied.
- **My own work**: requirements analysis and the PRD; design of the trust mechanisms (word-for-word quote checks, admission rules, email check rules); reviewing the AI-generated code; running with the real API and checking the results by hand.
