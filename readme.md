# DebatingNotes — Lesson Pack Generator

DebatingNotes turns messy debate lesson notes (PDF/Markdown/text) into polished, citation-backed **Google Docs handouts** for senior high-school students. It uses a compact **4-agent** OpenAI pipeline with strict schema validation, and publishes a consistently formatted Doc into a specified Drive folder.

---

## Contents

- [Why this version](#why-this-version)
- [Architecture & flow](#architecture--flow)
- [Project structure](#project-structure)
- [Security & credentials](#security--credentials)
- [Setup](#setup)
- [Usage](#usage)
- [Operational notes](#operational-notes)
- [Troubleshooting](#troubleshooting)

---

## Why this version

- **4 agents end-to-end** (fast & cost-aware):
  1. **Preprocessor** – normalize to clean Markdown  
  2. **Strategist** – frameworks + GOV & OPP cases + extension space  
  3. **Research & Adjudication** – curated examples with URLs + weighing & drills  
  4. **Synthesis/QA** – merge to a single voice; strict citation discipline

- **Idempotent publishing** – a content fingerprint is stored in Drive `appProperties`. Reprocessing the same content reuses the existing Doc rather than creating duplicates.

- **Credential hygiene** – least-privilege Google scopes, safe private-key parsing, and OAuth tokens are **opt-in** and kept outside the repo.

---

## Architecture & flow

| Stage | Component | Responsibility | Notes |
|---|---|---|---|
| Discover inputs | `src/index.ts` → `processFolder` | Scan target path for `*.pdf`, `*.md`, `*.markdown` | Prints a table mapping input ⇢ Google Doc URL |
| Normalize | `Preprocessor` (agent) | Turn messy notes into clean Markdown (keep headings/lists; remove filler) | Returns `{ title, markdown }` |
| Build cases | `Strategist` (agent) | First principles & metric; 3–5 GOV; 3–5 OPP; extension lanes; optional topic/context | No fabricated facts |
| Evidence + guidance | `Research & Adjudication` (agent) | Curated, verifiable examples with URLs; adjudicator weighing; drills | Uses OpenAI hosted web search tool |
| Merge & validate | `Synthesis/QA` (agent) + `schemas.ts` | Single voice, dedupe sources, final `LessonPack` validation | Zod schema = guardrail |
| Publish | `googleDocs.ts` | Create or reuse Doc in configured folder; structured headings & bullets | Stores `debatingnotes_fingerprint` |

---

## Project structure

```src/
  agents.ts        # All 4 agents (preprocessor, strategist, research&adj, synthesis/qa)
  config.ts        # Env loading, OpenAI client, Google auth (JWT or OAuth)
  googleDocs.ts    # Idempotent Create-or-Reuse + Google Docs layout
  pipeline.ts      # Orchestration and validation end-to-end
  schemas.ts       # Zod types for LessonPack and agent outputs
  index.ts         # CLI entrypoint
```

---

## Security & credentials

**Never commit secrets.** Copy `.env.example` to `.env` and fill in values. Supported Google credential modes (choose **one**):

| Method | `.env` key | Notes |
|---|---|---|
| File path | `GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json` | Easiest for local dev; keep the file **outside** the repo |
| Base64 JSON | `GOOGLE_CREDENTIALS_BASE64=...` | Best for CI; one env var containing base64 of the JSON |
| Inline JSON | `GOOGLE_CREDENTIALS_JSON={...}` | Quick start; ensure `\n` remain as literal `\\n` sequences |

For OAuth (optional, to write as a user rather than a service account), set `OAUTH_TOKEN_PATH` to a token file **outside** your repo (e.g., `/var/app/secrets/oauth.json`). If not set, a **service account (JWT)** is used.

**Scopes (least privilege):**

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive.file`

---

## Setup

1) **Prerequisites**

- Node.js 20+ and npm

2) **Install**

```bash
npm install
```

3) **Create `.env`** (at repo root) from `.env.example`, then set:

```dotenv
OPENAI_API_KEY=sk-...                 # required
OPENAI_ORG_ID=org_...                 # optional

# Choose exactly ONE of the three Google credential inputs:
# GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
# GOOGLE_CREDENTIALS_BASE64=...
# GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}

GOOGLE_EXPORT_FOLDER_ID=...           # the Drive folder ID for outputs

# OAuth (optional; if omitted, service account is used)
# OAUTH_TOKEN_PATH=/secure/oauth.json
# GOOGLE_OAUTH_CLIENT_ID=...
# GOOGLE_OAUTH_CLIENT_SECRET=...
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback
```

4) **Grant Drive access (service account)**

- Add the service account as a **member** of the target **Shared Drive** (recommended) or the specific folder.
- Give **Contributor** (or **Content manager**) permissions.

5) **Enable APIs (one-time)**

- In Google Cloud Console → **APIs & Services → Library**: enable **Google Drive API** and **Google Docs API**.

---

## Usage

**Type-check only**

```bash
npx tsc -p tsconfig.json --noEmit
```

**Process the current directory** (searches `**/*.{pdf,md,markdown}`):

```bash
npx ts-node src/index.ts
```

**Process a specific folder**:

```bash
npx ts-node src/index.ts /path/to/notes
```

Expected output: a console table with `file → https://docs.google.com/document/d/<id>/edit`.  
Re-running on the same content reuses the existing Doc (fingerprint idempotency).

---

## Operational notes

- **Citations**: Any new factual claim must include a real URL. The Research agent is the single source of factual examples and links. The Synthesis agent refuses to add facts without sources.
- **Backoff & retries**: Exponential backoff is applied for Google API 429/5xx responses.
- **Auditing**: `inputMetadata` records filename and type for traceability.
- **Extensibility**: To add a new section, extend `schemas.ts`, adjust the Strategist/Research prompts, and tweak the `googleDocs.ts` renderer.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `PERMISSION_DENIED` (403) | Service account not a member of the Shared Drive/folder | Add it as **Contributor** (or higher) |
| Doc created but not in the expected folder | Wrong `GOOGLE_EXPORT_FOLDER_ID` or missing permissions | Verify folder ID and membership |
| `invalid_grant` / key parse errors | Private key newline handling | Prefer file-path or base64 method; inline JSON must keep `\\n` escapes |
| OpenAI auth error | Missing/invalid `OPENAI_API_KEY` | Set a valid key in `.env` |
