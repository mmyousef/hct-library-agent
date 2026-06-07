# HCT Library AI Agent

> Intelligent reference assistant for the Higher Colleges of Technology Library.  
> Live demo: **https://mmyousef.github.io/hct-library-agent/**

---

## What This Is

A production-ready AI chat agent for academic library reference services. It answers student and faculty questions about library resources, databases, citation, borrowing, and services — grounded in your own library documents via Retrieval-Augmented Generation (RAG).

**Works immediately in demo mode** (no API key needed). Upgrade to real AI by adding your API key.

---

## Quick Start (5 minutes)

### Step 1 — Fork the repository

1. Go to https://github.com/mmyousef/hct-library-agent
2. Click **Fork** → keep the default settings → **Create fork**

### Step 2 — Enable GitHub Pages

1. In your forked repo, go to **Settings → Pages**
2. Source: **GitHub Actions**
3. Save

### Step 3 — Push to main to deploy

The GitHub Actions workflow (`deploy.yml`) deploys automatically on every push.

After ~1 minute, your agent is live at:  
`https://mmyousef.github.io/hct-library-agent/`

---

## Project Structure

```
hct-library-agent/
├── index.html                    # Main chat interface (GitHub Pages)
├── widget.js                     # Embeddable widget for library website
├── config.json                   # App configuration
├── stop_words.json               # Content moderation rules
├── wrangler.toml                 # Cloudflare Worker config
├── worker.js                     # API backend (deploy to Cloudflare Workers)
├── knowledge_base/
│   ├── faq_sample.json           # Built-in demo FAQ (29 entries)
│   ├── manifest.json             # Document inventory
│   └── documents/                # Your actual library documents go here
│       ├── reference/            # Library guides, policy PDFs
│       ├── policies/             # Circulation, access policies
│       └── web/                  # Scraped web pages (auto-populated)
├── scripts/
│   ├── ingest.py                 # PDF/DOCX/HTML → text chunks
│   ├── embed.py                  # Chunks → Pinecone vector index
│   └── scrape.py                 # Web crawler for library pages
├── chunks/                       # Auto-generated chunk files (git-ignored)
└── .github/workflows/
    ├── deploy.yml                # Auto-deploy to GitHub Pages on push
    └── reindex.yml               # Weekly knowledge base refresh (Sunday 02:00 GST)
```

---

## Operating Modes

### Demo Mode (default — no API key required)
- Works out of the box using `faq_sample.json`
- Keyword-based search — fast, fully client-side
- Shows **⚡ Demo Mode** badge in the UI

### Live AI Mode (requires API key + Cloudflare Worker)
- Full RAG pipeline: query → embeddings → Pinecone → Claude
- Responses grounded in your actual library documents
- Shows **🟢 Live AI** badge in the UI

---

## Upgrading to Live AI Mode

### What you need
| Service | Purpose | Cost |
|---------|---------|------|
| Anthropic API | Claude LLM | ~$5–20/month |
| OpenAI API | Embeddings (`text-embedding-3-small`) | ~$1–2/month |
| Pinecone | Vector database | Free starter tier |
| Cloudflare Workers | API backend | Free (100k req/day) |
| Supabase | Analytics logging | Free tier |

### Step 1 — Get API keys

- **Anthropic**: https://console.anthropic.com → API Keys
- **OpenAI**: https://platform.openai.com → API keys
- **Pinecone**: https://app.pinecone.io → Create index (1536 dims, cosine)
- **Supabase**: https://app.supabase.com → Create project → run SQL below

**Supabase table setup** (run in Supabase SQL Editor):
```sql
CREATE TABLE conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT,
  query        TEXT,
  response     TEXT,
  sources      TEXT[],
  model_used   TEXT,
  latency_ms   INTEGER,
  blocked      BOOLEAN DEFAULT false,
  block_category TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON conversations (created_at DESC);
CREATE INDEX ON conversations (session_id);
CREATE INDEX ON conversations (blocked);
```

### Step 2 — Deploy the Cloudflare Worker

```bash
# Install Wrangler CLI
npm install -g wrangler
wrangler login

# Create KV namespace for rate limiting
wrangler kv:namespace create "RATE_LIMIT_KV"
# Copy the returned id into wrangler.toml → kv_namespaces → id

# Set secrets (you will be prompted for each value)
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put PINECONE_API_KEY
wrangler secret put PINECONE_INDEX_HOST
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY

# Deploy
wrangler deploy
# Output: https://hct-library-api.mmyousef.workers.dev
```

### Step 3 — Add GitHub Secrets (for weekly reindex)

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|-------|
| `OPENAI_API_KEY` | Your OpenAI key |
| `PINECONE_API_KEY` | Your Pinecone key |
| `PINECONE_INDEX_HOST` | Your Pinecone index host URL |

### Step 4 — Update index.html

Edit the `CONFIG` block at the top of `index.html`:

```javascript
const CONFIG = {
  API_URL: 'https://hct-library-api.mmyousef.workers.dev',   // Your Worker URL
  DEMO_MODE: false,   // Switch to Live AI
  MAX_CHARS: 500
};
```

Commit and push — GitHub Actions redeploys automatically.

---

## Adding Library Documents

### Option A — Manual upload (PDFs, DOCX)

1. Place files in `knowledge_base/documents/reference/` (or `policies/`, etc.)
2. Run the ingestion pipeline locally:

```bash
# Install dependencies (once)
pip install pymupdf python-docx beautifulsoup4 trafilatura tiktoken openai pinecone-client

# Ingest documents → chunks
python scripts/ingest.py --source knowledge_base/documents/ --output chunks/ --verbose

# Embed chunks → Pinecone
export OPENAI_API_KEY="sk-..."
export PINECONE_API_KEY="..."
export PINECONE_INDEX_HOST="https://..."
python scripts/embed.py --input chunks/ --verbose
```

### Option B — Scrape library web pages

1. Create `urls.txt` in the project root with your library guide URLs:
```text
# HCT Library pages to scrape
https://library.hct.ac.ae/databases
https://library.hct.ac.ae/guides/citing-apa
https://guides.hct.ac.ae/subject-guides
```

2. Run the scraper:
```bash
python scripts/scrape.py --urls urls.txt --output knowledge_base/documents/web/ --verbose
```

3. Then run `ingest.py` and `embed.py` as above.

### Option C — Automatic weekly refresh

Commit `urls.txt` to the repo and add GitHub Secrets (Step 3 above).  
The `reindex.yml` workflow runs every Sunday at 02:00 GST automatically.

---

## Embedding the Widget on the Library Website

Add one line to any page on your library website:

```html
<script
  src="https://mmyousef.github.io/hct-library-agent/widget.js"
  data-position="bottom-right"
  data-theme="hct"
  data-lang="en"
  async>
</script>
```

### Widget options

| Attribute | Values | Default |
|-----------|--------|---------|
| `data-position` | `bottom-right`, `bottom-left` | `bottom-right` |
| `data-lang` | `en`, `ar` | `en` |
| `data-theme` | `hct` | `hct` |
| `data-api-url` | Your Worker URL | (demo mode) |

For Arabic (RTL) support:
```html
<script src="..." data-lang="ar" async></script>
```

---

## Version Management

This project follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

```bash
# Tag a new release
git tag -a v1.1.0 -m "Add: PDF ingestion pipeline"
git push origin v1.1.0
```

| Version type | When to use | Example |
|---|---|---|
| PATCH | Bug fixes, content updates | `v1.0.1` |
| MINOR | New features, new document types | `v1.1.0` |
| MAJOR | Breaking changes, architecture changes | `v2.0.0` |

View all versions: `git tag -l`  
Roll back: `git checkout v1.0.0`

---

## Viewing Analytics

All interactions are logged to Supabase. Query them at https://app.supabase.com:

```sql
-- Daily usage summary
SELECT DATE(created_at) as date,
       COUNT(*) as total_queries,
       COUNT(*) FILTER (WHERE blocked) as blocked,
       ROUND(AVG(latency_ms)) as avg_latency_ms
FROM conversations
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- Most common queries
SELECT query, COUNT(*) as frequency
FROM conversations
WHERE NOT blocked
GROUP BY query ORDER BY 2 DESC LIMIT 20;

-- Blocked query breakdown
SELECT block_category, COUNT(*) as count
FROM conversations
WHERE blocked = true
GROUP BY 1 ORDER BY 2 DESC;
```

---

## Content Moderation

The agent has a 3-layer moderation system:

1. **Layer 1 — Regex filter** (client-side, <5ms): Catches obvious violations using `stop_words.json`
2. **Layer 2 — Worker filter** (server-side, <10ms): Additional patterns in `worker.js`
3. **Layer 3 — Scope check** (LLM-level): System prompt instructs Claude to decline off-topic queries

To update blocked terms, edit `stop_words.json` and commit to `main`.

Formal refusal templates (never say "I can't") are defined in `stop_words.json` under `response_templates`.

---

## Emergency Procedures

### Disable the agent immediately
In `index.html`, set:
```javascript
const CONFIG = { DEMO_MODE: true, API_URL: '' };
```
Commit and push. The agent falls back to demo mode within ~60 seconds.

### Disable the Cloudflare Worker
```bash
wrangler undeploy
```

### Roll back to a previous version
```bash
git checkout v1.0.0
git push origin HEAD:main --force
```

---

## Support

- Library email: library@hct.ac.ae
- Systems Librarian: mmyousef@hotmail.com
- GitHub Issues: https://github.com/mmyousef/hct-library-agent/issues

---

*HCT Library AI Agent v1.0.0 — Higher Colleges of Technology, UAE*
