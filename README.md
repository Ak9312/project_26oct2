# AI Content Quality Auditor

An n8n workflow that scores articles out of 100 with an AI model on [Groq](https://groq.com), saves every result to Google Sheets, and sends low scores to a person for review. It comes with a small web app on Vercel for submitting articles, reading reports, working the review queue and checking the auditor against your own scores on 30 test articles.

```mermaid
flowchart LR
  A[Web app on Vercel] -->|password + secret| B[n8n: audit pipeline]
  B --> C[Readability<br/>code]
  B --> D[Groq: relevancy,<br/>claims, intent]
  D --> E[SerpAPI: verify<br/>each claim]
  B --> F[SerpAPI: top results<br/>→ section gaps]
  B --> G[Copyscape:<br/>plagiarism]
  C & E & F & G --> H[Score /100]
  H --> I[(Google Sheets<br/>Results)]
  H -->|below pass mark<br/>or hard flag| J[(Review tab)<br/>+ Gmail alert]
  A -->|read / save| K[n8n: app API] --> I
```

## Scoring (100 points)

| Parameter | Points | How it is checked |
|---|---|---|
| **Accuracy and relevancy** | 30 | Heading ↔ content match, 0–10 per H2/H3, averaged (10). Factual claims pulled out by the AI, each searched on Google via SerpAPI, then judged **only from those search results** (12). Time-sensitive statements (5). Does the article deliver what the title promises (3). |
| **Readability** | 20 | Hemingway-style, computed in code: ARI grade vs your target (8), share of hard/very hard sentences (6), passive voice (3), adverbs per 100 words (3). |
| **Keywords** | 20 | Primary keyword in title, H1, first 100 words and meta description (6). Density 0.5–2.5% (4). Your secondary keywords plus up to 10 related terms, each checked in the text by code (6). Search intent match (4). |
| **Missing sections** | 20 | Headings of the top-ranking pages are compared with yours; subtopics that appear on at least 3 of them must be covered (12). Intro, conclusion, FAQ, 3+ H2s (4). Length vs the median of the top pages (4). |
| **Plagiarism** | 10 | Copyscape internet search with full comparison: 0–5% match = 10, 5–10% = 6, 10–15% = 2, over 15% = 0. |

**An article goes to human review** when the total is below the pass mark (70 by default), when any claim is contradicted by a search result, when plagiarism is over 15%, or when a check could not run (for example, SerpAPI or Copyscape failed). A failed check never counts as a pass.

### How hallucination is kept out

- The AI never decides whether a related term is present; code searches the text.
- A claim is only marked **verified** or **false** if the AI points to one of the search results it was given. Any other verdict, or a made-up URL, is downgraded to **unverified**.
- Every number the AI returns is clamped to its range, and missing answers score as missing, not as full marks.
- Readability, keyword placement, density, structure, length and plagiarism bands involve no LLM at all.

### About Hemingway

Hemingway Editor has no public API, so it can't be called from n8n. Readability rebuilds its approach instead: the Automated Readability Index for the grade (Hemingway's default target is grade 9), plus sentence-level hard/very-hard flags, passive voice and adverbs. The sentence thresholds and point bands are this project's own and are expected to be tuned during validation. When you score the 30 test articles, paste each one into Hemingway and compare.

## What's in the repo

```
n8n/                      Import these into n8n
  content-auditor-audit.json   Audit pipeline (35 nodes)
  content-auditor-api.json     Reads and saves app data (8 nodes)
sheets/                   Header rows for the three Google Sheet tabs
public/                   Web app (plain HTML/CSS/JS)
api/                      Vercel functions: password check, proxy to n8n
src/                      Scoring code, inlined into the n8n Code nodes
scripts/                  Workflow generator, mock data, local server
tests/                    Unit tests + end-to-end workflow simulation
```

The n8n Code nodes are generated from `src/` by `npm run generate`, so the code that runs in n8n is the same code the tests run. Edit `src/`, never the Code nodes, then regenerate and re-import.

## Setup

You need: an n8n instance (n8n Cloud or self-hosted, reachable over HTTPS), and accounts for Groq (free plan works, see [Groq limits](#groq-limits)), SerpAPI, Copyscape (Premium API) and Google.

### 1. Google Sheet

1. Create a new Google Sheet.
2. Make three tabs named exactly **Results**, **Review** and **Validation**.
3. Put the header row in each from the matching file in `sheets/` (File → Import → Upload, "Replace current sheet", or paste the single line into row 1).
4. Copy the Sheet ID from its URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

### 2. n8n

1. **Create credentials** (n8n → Credentials → Add credential). Use these exact names so the imported nodes pick them up:

   | Credential name | Type | Fields |
   |---|---|---|
   | Content Auditor webhook secret | Header Auth | Name `x-auditor-secret`, Value: a long random string (`openssl rand -hex 32`) |
   | Groq account | **Groq** (built-in type; search "Groq") | API Key: your key from [console.groq.com/keys](https://console.groq.com/keys) (starts with `gsk_`). Click **Test**: a green "Connection tested successfully" means the key works. |
   | SerpAPI key | Query Auth | Name `api_key`, Value: your SerpAPI key |
   | Copyscape API key | Query Auth | Name `k`, Value: your Copyscape API key |
   | Google Sheets account | Google Sheets OAuth2 API | Sign in with Google |
   | Gmail account | Gmail OAuth2 API | Sign in with the Google account that sends the alerts |

   On self-hosted n8n, Google sign-in needs your own Google Cloud OAuth client; see n8n's Google credentials docs.
2. **Import** both files from `n8n/` (Workflows → Import from file).
3. In each workflow, open any node with a credential warning and pick the credential from step 1.
4. **Edit the `Config` node** in each workflow:
   - Audit pipeline: `SPREADSHEET_ID`, `REVIEW_EMAIL`, `APP_URL` (your Vercel URL), `COPYSCAPE_USERNAME`, and optionally `MODEL`, `REASONING_EFFORT`, `MAX_PROMPT_CHARS`, `LLM_PAUSE_SECONDS`, `PASS_MARK`, `COMPETITOR_PAGES` (see [Groq limits](#groq-limits)).
   - App API: the same `SPREADSHEET_ID` and `PASS_MARK`.
5. **Activate** (publish) both workflows. The app calls their production URLs:
   `https://<your-n8n>/webhook/content-auditor/audit` and `.../webhook/content-auditor/api`.

### 3. Vercel

1. Vercel → Add New → Project → import `Ak9312/project_26oct2`. No framework preset and no build command are needed (`vercel.json` handles it).
2. Add environment variables (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | The password people will type to use the app |
   | `N8N_BASE_URL` | e.g. `https://yourname.app.n8n.cloud` (no trailing slash) |
   | `N8N_WEBHOOK_SECRET` | The same random string as the n8n webhook credential |

3. Deploy. Open the site; the header shows "n8n connected" when all three are set, or lists what's missing.
4. Put the deployed URL into `APP_URL` in the audit pipeline's Config node, so the review emails link to the report.

### 4. First run

Submit one article from the app. You land on the report page, which updates by itself. An audit usually takes 2–4 minutes, including two short pauses that keep it inside Groq's free-plan limits. If a step fails (for example a Groq rate limit or a site that blocks fetching), the report says so and names the step instead of loading forever. If nothing at all appears after 6 minutes, open **Executions** in n8n for the audit pipeline.

## Groq limits

The AI steps run on Groq. Groq's limits apply per organization, so extra API keys don't add capacity. Your exact numbers are at [console.groq.com/settings/limits](https://console.groq.com/settings/limits). Groq's docs list these limits for `openai/gpt-oss-120b`, the default model here: 30 requests a minute, 1,000 a day, **8,000 tokens a minute** and **200,000 tokens a day**.

The tokens-per-minute limit is the one an audit can hit, so the workflow is built around it:

- **`MAX_PROMPT_CHARS`** (default 14,000, about 3,500 tokens) caps how much article text goes into one request. Long articles are shortened section by section, and the report says when that happened.
- **`LLM_PAUSE_SECONDS`** (default 20) pauses before the second and third Groq calls, so a single audit doesn't use up the minute's tokens.
- Each Groq call **retries 5 times, 5 seconds apart**, when it fails.
- If a call still fails, the audit **finishes anyway**. The report and the review email say which step failed and why (for example *"Groq rate limit reached (429)"*), and the audit is marked **Failed** so it doesn't count in validation.

Roughly, one audit uses 10,000–15,000 tokens, so the daily token limit allows on the order of 15 audits a day on the free plan. Your real usage is visible in the Groq console. To run all 30 validation articles in one day, either spread them over two days or move to a paid Groq plan. On a paid plan, raise `MAX_PROMPT_CHARS` (e.g. 40,000) and set `LLM_PAUSE_SECONDS` to 1.

`MODEL` accepts any Groq chat model ID from [console.groq.com/docs/models](https://console.groq.com/docs/models). For `openai/gpt-oss-*` models, `REASONING_EFFORT` can be `low` (default, fastest and fewest tokens), `medium` or `high`. Other models ignore it. Groq has separate limits per model, so switching models also gives you a separate budget.

## Validation against your own scores (30 articles)

1. Run each of your 30 test articles through the app.
2. On each report, before reading it closely, fill in **My scores** at the bottom using the same rubric. They're saved to the Validation tab. You can also type them straight into the tab, keyed by `audit_id`.
3. Open **Validation** (on the Review page). It shows the average gap in points, the correlation, the pass/fail agreement and the bias, overall and per parameter.
4. Any parameter with an average gap over 3 points is highlighted. Adjust that part (prompt wording in `src/llm.js`, thresholds in `src/readability.js` or `src/keywords.js`, bands in `src/scoring.js`), run `npm run generate`, re-import the workflow and re-run the articles.

Targets shown in the app: an average total gap within 5 points, and pass/fail agreement on at least 27 of 30. These are goals to test against, not results.

## Costs

Every audit makes up to 3 Groq calls (fewer when there are no checkable claims or no competitor pages), 1 SerpAPI search per claim (up to 8) plus 1 for the keyword, 1 Copyscape full-comparison search, and fetches up to 8 competitor pages. Check current pricing with each provider; Copyscape charges per search and full comparisons cost more than a basic search. The app password and the webhook secret stop strangers from spending your credits.

## Local preview and development

```bash
MOCK_MODE=1 npm run dev     # http://localhost:3000 with sample data, no n8n needed
npm test                    # 46 tests: scoring, API handler, and end-to-end runs of both workflows
npm run generate            # rebuild n8n/*.json and the mock data from src/
npm run check               # tests + confirm the committed workflows match src/
```

No dependencies to install; Node 20 or newer is enough.

## Known limits

- **Sites that block bots** (or need JavaScript to show text) can't be fetched; paste the content instead. The same applies to some competitor pages, which are skipped.
- **Originality.ai is not included.** Its official API reference wasn't reachable when this was built, so its plagiarism endpoint couldn't be confirmed; Copyscape (documented) does the scored check. It can be added later as a separate node.
- **Readability is an approximation of Hemingway**, not Hemingway's own score; validation will show how close it is.
- Claims are verified against Google snippets only. A true claim with no clear snippet stays **unverified** (half credit) rather than being guessed.
- Google Sheets cells hold 50,000 characters, so very large reports are trimmed (competitor list and evidence first) before saving.
- The n8n node versions used were checked against n8n 2.44.7's node definitions. If an import ever shows a node as unknown, update n8n.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "n8n rejected the webhook secret" | `N8N_WEBHOOK_SECRET` in Vercel differs from the n8n header credential value, or the header name isn't `x-auditor-secret`. |
| "n8n webhook not found" | A workflow isn't active, or `N8N_BASE_URL` is wrong. |
| "Couldn't read the Google Sheet" | Wrong `SPREADSHEET_ID`, a tab name doesn't match exactly, or the Google credential lacks access. |
| Report never appears | Check n8n Executions. Most often the article URL blocked the fetch, or an API key is wrong. |
| Report says "Groq rate limit reached (429)" | You hit Groq's tokens-per-minute or daily limit. Wait a minute and run it again, raise `LLM_PAUSE_SECONDS`, lower `MAX_PROMPT_CHARS`, or check usage at console.groq.com. |
| Report says "Groq rejected the API key (401)" | The key in the **Groq account** credential is wrong or was revoked. Paste a fresh key and click **Test**. |
| "Groq" isn't in n8n's credential list | Your n8n has its AI nodes turned off. Create a **Header Auth** credential instead (Name `Authorization`, Value `Bearer gsk_...`), then in the three **Groq:** nodes set Authentication to *Generic Credential Type → Header Auth* and pick it. |
| Every article goes to review with "Plagiarism check did not run" | Copyscape username/key wrong, or the account has no credit. |
