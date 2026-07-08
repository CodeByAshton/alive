# Vault

An AI-native workspace: an Obsidian-style vault that lives in the cloud, syncs in real time across genuinely separate devices, and has an assistant that is a first-class inhabitant of the vault — not a chat box bolted on.

## Getting to production — the complete step-by-step guide

This is everything you personally need to do to take Vault from this repository to a real product people can use. Written assuming no technical background — every command is copy-paste. You'll use the **Terminal** app (on a Mac: press `Cmd+Space`, type "Terminal", press Enter). One rule to remember: **lines starting with `export` set secrets for the current Terminal window only — re-paste them whenever you open a new window.**

### Part A — See it working on your computer (~15 minutes)

**A1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the "LTS" version, double-click, next-next-finish. This is the engine that runs Vault.

**A2. Start Vault with the practice AI** (no accounts or keys needed). In Terminal, go into this project's folder (type `cd `, drag the folder onto the Terminal window, press Enter), then paste:

```bash
npm install
VAULT_ENABLE_MOCK=1 npm run dev
```

Open **http://localhost:5173** in your browser. That's Vault. Leave the Terminal window open — closing it turns Vault off.

**A3. (Recommended) Run the built-in test suites** so you know your copy is healthy:

```bash
npm run test:auth     # should end "11/11 auth checks passed"
npm run test:oauth    # should end "8/8 oauth checks passed"
```

### Part B — Plug in the real AI (~5 minutes)

**B1.** Create an account at [console.anthropic.com](https://console.anthropic.com), add a payment method, then **API Keys → Create Key** and copy it. This key is how the assistant thinks; Anthropic bills you per use.

**B2.** Start Vault with the key (paste yours in place of the dots):

```bash
export ANTHROPIC_API_KEY=...
npm run dev
```

Start a chat and talk to it. This is the first time the real model runs through the whole system — if anything behaves oddly here, that's the first thing to report next session.

### Part C — Make the vault permanent with your database (~10 minutes)

Right now notes live in a file on your computer. Your Supabase database (already set up — the tables exist) makes them permanent.

**C1.** Open your [Supabase dashboard](https://supabase.com/dashboard) → your project → **Project Settings → API Keys** → copy the **service_role** key. Treat it like a master password — never paste it anywhere public.

**C2.** Verify, then run:

```bash
export SUPABASE_URL=https://tjwlmdadhtywffsoeulv.supabase.co
export SUPABASE_SERVICE_KEY=...      # the service_role key
npm run smoke:supabase               # must say PASS on every line
npm run dev
```

### Part D — Put it on the internet (~30 minutes, the big one)

After this, your phone works from anywhere, sign-in accounts are on, and other people can use it.

**D1.** Create a free account at [fly.io](https://fly.io), then install their command-line tool: [fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/) (one copy-paste command).

**D2.** In the project folder:

```bash
fly launch --copy-config --no-deploy
```

It asks a few questions — accepting the suggestions is fine.

**D3. Set your secrets.** The most important step; go slowly and replace every `...`:

```bash
fly secrets set \
  VAULT_AUTH=accounts \
  SUPABASE_URL=https://tjwlmdadhtywffsoeulv.supabase.co \
  SUPABASE_SERVICE_KEY=... \
  SUPABASE_ANON_KEY=sb_publishable_qKIF-FojyKP7Jg7HI-TlPQ_Q5oiY3gD \
  ANTHROPIC_API_KEY=... \
  VAULT_SECRET_KEY=$(openssl rand -hex 32)
```

What each one does: `VAULT_AUTH=accounts` turns on email sign-in — each person gets their own private vault, which is what makes this sellable. The `ANON_KEY` is public by design (safe to share). `VAULT_SECRET_KEY` locks connector authorizations — that command generates a random one for you.

**D4. Deploy:**

```bash
fly deploy
```

Fly prints your address, like `https://your-app.fly.dev`. Open it — you should see the **sign-in screen**. Create your account. You're live.

**D5. One Supabase toggle:** dashboard → **Authentication → Sign In / Up** → turn **off** "Confirm email" if you want sign-ups to work instantly (leave it on to make people verify their email first — Supabase sends those emails for you).

**D6. Lock the door** once everything works:

```bash
fly secrets set VAULT_ALLOWED_ORIGINS=https://your-app.fly.dev
fly deploy
```

### Part E — Connect your devices to the deployed Vault

- **Phone:** open `https://your-app.fly.dev` in the phone's browser and sign in. Use "Add to Home Screen" for an app-like feel.
- **Your computer, as the assistant's hands** (lets it run commands for you):

```bash
npm run node-harness -- --server wss://your-app.fly.dev
```

Every command shows an **Approve / Deny** card on your screens first; the pause switch under **Devices** stops the assistant everywhere, instantly.

- **Connectors:** in the app, Customize → Connectors → pick Notion/Linear/etc. → **Connect** → approve in the popup. (OAuth popups need the deployed HTTPS address, so do this after Part D.)
- **Your notes are always yours:** Settings (gear icon) → **Export vault** downloads everything as plain Markdown, any time.

### Part F — What still needs things only you can get

| To ship | You need | Then |
| --- | --- | --- |
| **Selling it — next build** | A [Stripe](https://stripe.com) account (free to create) | The pricing plan is written up in `NEXT_STEPS.md` — subscriptions, free tier, usage limits |
| Mac desktop app | Apple Developer account ($99/yr) + a Mac | Signing gets wired into the release workflow; installers then build automatically |
| iPhone App Store app | Same Apple account + a Mac with Xcode | `npm run ios:sync`, open in Xcode, TestFlight → App Store |
| Custom domain (vault.yourname.com) | The domain (~$12/yr) | `fly certs add vault.yourname.com` + one DNS record at your registrar |

### Quick health checks, any time

```bash
npm run test:auth        # accounts security (offline, no setup needed)
npm run test:oauth       # connector OAuth (offline, no setup needed)
npm run test:automations # custom learning: scheduler, memory, reflection (offline, no setup needed)
npm run smoke:supabase # live database round-trip (needs the two SUPABASE exports)
npm run e2e            # 39 end-to-end checks (start dev first: VAULT_ENABLE_MOCK=1 VAULT_FETCH_ALLOW=localhost npm run dev)
```

---

**The two things that are the point:**

1. **Cross-session / cross-device continuity.** The vault and every conversation persist in the cloud and sync live to every connected device, each of which keeps a fast local IndexedDB cache. Close the tab, switch from phone to laptop — everything is exactly as left. Chats are folders; each turn is a Markdown file with frontmatter (`role`, `timestamp`, `device`, `provider`, `model`, `tools_used`). Resuming a session is just re-reading those records — there is no separate session database that can drift from the vault.
2. **Implicit device-awareness.** Each client registers with a cloud presence registry, advertising a device descriptor (type + capabilities). The assistant's tools are assembled **per-turn from which devices are currently present**: with only the phone connected the toolset is conversational (+ voice); the moment a desktop comes online, vault-editing tools exist; the moment a machine running the **node harness** comes online, it can run commands there. The model is never told which device is active and never announces it — capability simply changes because presence changed.

## Installable apps

**Desktop (macOS / Windows / Linux)** — an Electron app, Obsidian/Claude-Desktop style. Installing it is the whole story on a computer: it boots the vault server locally, opens the UI against it, and runs the node harness — the machine immediately becomes a fully capable device for every surface on the same vault (your phone connects to it over the LAN or a tunnel).

```bash
npm run desktop           # run the desktop app from source
npm run dist:desktop      # build installers into release/ (dmg/zip, nsis, AppImage/deb)
```

Pushing a tag like `v0.1.0` triggers `.github/workflows/release.yml`, which builds installers on macOS/Windows/Linux runners and attaches them to a GitHub Release — the artifacts a download page links to. Set `VAULT_REMOTE=https://your-server` to run the desktop app against a hosted vault instead of its local one. (Code signing/notarization for macOS distribution still needs an Apple Developer identity wired into the workflow.)

**iPhone (App Store / TestFlight)** — a Capacitor iOS app wrapping the same client lives in `ios/`. On first launch it shows a connect screen (server URL + vault key), then behaves exactly like the phone surface — same vault, same continuity, voice included, plus reminder notifications via `@capacitor/local-notifications` (already registered in the iOS project; iOS asks for permission the first time you tap the bell). Building/submitting requires a Mac:

```bash
npm run ios:sync          # build web assets into the iOS project
npx cap open ios          # open in Xcode → sign → run / archive → App Store Connect
```

The client auto-detects where it's running: same-origin in a browser or the desktop app (zero config), explicit server URL in the native shell (`?server=http://host:8787` works in any browser too, and the server sends CORS for it).

## The node harness (act on your computer)

Talk to the agent on your phone over AirPods, open your laptop, and — if the harness is running there — the same conversation can now act on that machine:

```bash
npm run node-harness -- --server ws://<vault-host>:8787 --workspace ~/dev/myproject
```

That registers the laptop as a device with `exec` capability. While it's connected, every turn's toolset includes `run_command` (shell in the workspace: git, builds, tests, installed CLIs like `claude` or `codex`). Close the terminal and the capability vanishes from the next turn. Commands are dispatched over the same WebSocket, run with a timeout inside the workspace, and stream their output back into the conversation on every device.

## Connectors

Customize → Connectors opens a Claude-style gallery of hosted MCP servers (Notion, Linear, Sentry, Stripe, Supabase, GitHub, Zapier, …) plus a Custom option for any MCP URL. OAuth providers are one click: **Connect** opens the service's consent popup and Vault handles the whole flow — discovery, dynamic client registration, PKCE, token refresh. Tokens are AES-256-GCM encrypted before they touch a vault record (set `VAULT_SECRET_KEY` on stateless deploys so authorizations survive redeploys). Each connector carries an **Ask first / Trusted** policy — Ask first routes every tool call through the same on-screen approval cards as commands. `npm run test:oauth` proves the flow offline against a mock OAuth provider.

## Custom learning: automations + memory

The assistant learns, then hands the work off to something that isn't a model.

**Automations** (Customize → Automations) are Markdown files under `.vault/automations/` — frontmatter (name, schedule, enabled), a plain-language paragraph explaining what it does, and a fenced `js` script. A deterministic scheduler on the server fires them with **no model involved**: `notify(...)` reaches every device live (toast), persists to `.vault/notifications.md`, and lands as a real iPhone notification (see below); scripts can also read/write notes and fetch public URLs. Schedules read like speech: `daily 09:00`, `weekdays 08:30`, `weekly mon 18:00`, `every 30 minutes`, `once 2026-07-09 14:00` (interpreted in `settings.timezone` / `VAULT_TIMEZONE`). You never hand-edit a script — **Edit automation** opens a prompt window where you describe the change in plain language and one model call rewrites the file. Ask in chat ("remind me to take my meds at 9") and the assistant saves one through the same on-screen approval cards as commands; the vault-wide kill switch pauses the scheduler too.

**iPhone notifications, no push servers**: automation files sync to every device, so the iOS app computes upcoming reminder times itself (`shared/schedule.mjs`, device timezone) and registers them as **local notifications** — they fire on a locked phone with the app closed, no APNs or push infrastructure. Tap the bell on the phone surface to grant permission; schedules re-mirror automatically whenever automations change or the app resumes. While the app is open in the background, a firing automation's live message becomes a system notification too (also in desktop browsers via the Notification API). The one gap: *conditional* script output (a `notify()` behind an `if`) can't be precomputed — it reaches a closed app on next open via sync; true APNs push is the eventual answer for that.

**Memory** (the Memory pane in the same view) is a visible, editable note (`.vault/memory/observations.md`) loaded into every turn — the assistant appends to it with `save_memory` when it learns something durable. A daily **reflection** pass (one cheap model call; `VAULT_REFLECTION_MODEL`, default Haiku) mines recent chats for patterns: durable facts land in memory, and repeated asks become *suggested* automations — created disabled, waiting for an explicit Approve in the UI (Dismiss is remembered and never re-proposed). `npm run test:automations` proves the whole loop offline.

## Web access

The assistant can read the web in every conversation: a `fetch_url` tool (any provider, any model — SSRF-guarded so only public addresses are reachable) plus Anthropic's native `web_search` when the provider is Claude (real search results with citations, executed server-side by the API; disable with `VAULT_WEB_SEARCH=0`).

## Context wiring

- **`AGENT.md`** at the vault root is the vault's CLAUDE.md — standing instructions loaded into every turn. Edit it like any note.
- **References**: mention `[[Any Note]]` or `@path/to/file.md` in a chat message and the harness inlines those files into the turn's context.
- **`context/`** is the conventional home for standing personal context (see the seeded `context/About Me.md`).
- **Skills** (`skills/*.md`, frontmatter `name`/`trigger`/`description` + instructions body) load when you type their slash command; create them from the Skills panel or by hand.

## Quick start

```bash
npm install

# API keys for the providers you want (any subset):
export ANTHROPIC_API_KEY=...        # Claude (default provider)
export OPENAI_API_KEY=...           # GPT
export GEMINI_API_KEY=...           # Gemini (via its OpenAI-compatible endpoint)
export OLLAMA_URL=http://localhost:11434   # local models (default shown)

# No keys at all? Demo the entire harness with the built-in mock engine:
export VAULT_ENABLE_MOCK=1

# Optional: persist the vault in Supabase Postgres instead of a local JSON
# file (state survives redeploys; schema in supabase/migrations/):
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_KEY=...     # service role key — server-side only, never ship to a client

npm run dev     # cloud backend on :8787 + Vite on :5173
```

Open **`http://localhost:5173/?surface=desktop`** on your laptop and **`http://<lan-ip>:5173/?surface=phone`** on your phone (or a second machine/browser). Both attach to the same vault via a shared vault key (`VAULT_KEY`, default `vault-dev-key`; pass `?key=...` on the URL for non-default keys).

Production-ish: `npm run build && npm start` serves the built client and the API from one process on `:8787`.

## User accounts (Supabase Auth)

By default the server runs in shared-key mode (`VAULT_KEY`) — one vault, the self-host setup. Set `VAULT_AUTH=accounts` and it becomes multi-tenant: clients sign in with email+password via Supabase Auth, present their access token on the WS/API, and the server verifies it and serves **each user their own isolated vault** (own presence registry, approvals, modes, kill switch — broadcasts never cross vaults).

```bash
export VAULT_AUTH=accounts
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_ANON_KEY=sb_publishable_...   # public; served to clients via /api/config
export SUPABASE_SERVICE_KEY=...               # vault storage in Postgres (recommended)
export SUPABASE_JWT_SECRET=...                # optional: verify tokens locally, no auth round-trips
                                              # (dashboard → Project Settings → JWT Keys → legacy secret)
```

Token verification is local (HS256) when `SUPABASE_JWT_SECRET` is set, otherwise against GoTrue with a short cache. Vault rows are looked up by `owner_id`; the node harness authenticates with `--token <access token>` instead of `--key`. `npm run test:auth` covers the whole thing offline (token verification, rejection, per-user isolation, scoped presence) — 11 checks, no Supabase account needed.

## Deploy

The whole thing ships as one container (client + API + WS on `:8787`) — see the `Dockerfile`:

```bash
docker build -t vault .
docker run -p 8787:8787 -e VAULT_KEY=... -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... -e ANTHROPIC_API_KEY=... vault
```

With Supabase configured the container is stateless (the vault lives in Postgres); without it, mount a volume at `/data`. A ready `fly.toml` is included for Fly.io (`fly launch --copy-config --no-deploy`, set secrets, `fly deploy`). For a hardened deployment also set `VAULT_ALLOWED_ORIGINS` (comma-separated) instead of the default open CORS, and pick a strong `VAULT_KEY`. Phones and other devices connect to the deployed URL with `?server=https://your-app.fly.dev&key=...`.

## Demo script (definition of done)

1. Open the app → vault tree with seeded notes, graph in the right rail.
2. Create a note with a `[[wikilink]]` → the edge appears in the graph.
3. Start a chat → a folder appears under `chats/`; each turn is a Markdown file inside it; the assistant streams via Claude.
4. Ask it to create or edit a note → the change lands live in the tree and graph on **every** device.
5. Type `/summarize`, `/journal`, or `/task` → the skill file's instructions (from `skills/`, editable vault content) load into the turn.
6. Switch the model mid-conversation (picker in the chat header) → the thread continues with full context; each message records which model produced it.
7. Reload / open a second device → vault and conversation are exactly as left, restored from cloud into the local cache; edits propagate live.
8. **Device-awareness:** with only the phone connected, ask it to reorganize the vault — it stays conversational (the editing tools don't exist for that turn) and never says why. Bring the desktop online, continue the same thread — now it acts, again without announcing the device switch.

`node scripts/e2e.mjs` runs this as an automated 15-check Playwright suite using two real browser contexts (start the dev servers with `VAULT_ENABLE_MOCK=1` first).

## Architecture

```
┌─ device: desktop ────────────┐        ┌─ cloud (server/) ───────────────────┐
│ React UI (rail/tree/editor/  │  WS    │ VaultStore     canonical records    │
│   chat/graph) + Dexie cache  │◀──────▶│ Presence       device registry      │
└──────────────────────────────┘        │ Harness        session log,        │
┌─ device: phone ──────────────┐        │                per-turn tool       │
│ Chat + voice surface         │◀──────▶│                assembly, context   │
│ Dexie/IndexedDB cache        │  WS    │                wiring (AGENT.md,   │
└──────────────────────────────┘        │                [[refs]], skills)   │
┌─ device: your computer ──────┐        │ ModelEngines   anthropic │ openai  │
│ node harness (agent/)        │◀──────▶│  (stateless)   gemini │ ollama │…  │
│ run_command in a workspace   │  WS    └─────────────────────────────────────┘
└──────────────────────────────┘
```

- **Engines are stateless and swappable; the harness is stateful and singular.** The harness owns the conversation (vault records), presence, and tool assembly; every engine gets the same neutral context (`system`, `messages`, `tools`, `executeTool`) — so swapping models mid-thread loses nothing. Adding a provider = implementing one engine (`server/engines/`).
- **The cloud layer is a seam.** `server/store.mjs` + the WS protocol in `src/lib/sync.ts` play the Supabase role (Postgres/Realtime/Presence). Persistence is already swappable: set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` and `server/store-supabase.mjs` mirrors the vault into Postgres (schema in `supabase/migrations/`); the record model maps 1:1 to the `vault_records` table. Realtime/Presence/Auth remain on the WS server for now.
- **Voice** is Web Speech API behind a `VoiceEngine` interface (`src/lib/voice.ts`) — swap for Deepgram/realtime later. Voice-initiated, screen-confirmed: speak on the phone, watch edits land on the desktop.
- **Sync** is last-write-wins per record with a monotonic rev cursor, tombstoned deletes, and a durable offline outbox on each client.

## Security posture (prototype)

Auth is a shared vault key — enough to make "separate devices, one vault" real, nothing more. The trust boundary is a real seam and is marked `// TODO: trust boundary` where a production build needs device attestation, scoped per-device capability grants (server-issued, not client-declared), and a kill switch. A voice-triggered agent with vault access across devices is a high-value target; don't expose this prototype to the internet as-is.
