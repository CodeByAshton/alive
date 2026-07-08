# Vault

An AI-native workspace: an Obsidian-style vault that lives in the cloud, syncs in real time across genuinely separate devices, and has an assistant that is a first-class inhabitant of the vault — not a chat box bolted on.

## Your next steps (no tech background needed)

Everything below is copy-paste. You'll need the **Terminal** app (on a Mac: press `Cmd+Space`, type "Terminal", press Enter).

**Step 1 — Run Vault on your computer.**
Install Node.js first (go to [nodejs.org](https://nodejs.org), download, double-click, next-next-finish). Then in Terminal, inside this project's folder, paste:

```bash
npm install
VAULT_ENABLE_MOCK=1 npm run dev
```

Open **http://localhost:5173** in your browser. That's Vault, running with a practice AI (no account needed). Leave the Terminal window open while you use it.

**Step 2 — Plug in the real AI.**
Create an API key at [console.anthropic.com](https://console.anthropic.com) (sign up → API Keys → Create Key → copy it). Then start Vault like this instead, pasting your key in place of the dots:

```bash
export ANTHROPIC_API_KEY=...
npm run dev
```

**Step 3 — Make your vault permanent (Supabase).**
Right now your notes live in a file on this computer. To keep them safe in your Supabase database instead: open your [Supabase dashboard](https://supabase.com/dashboard) → your project → **Project Settings** → **API Keys** → copy the **service_role** key (keep it secret — it's a master key). Then start Vault like this:

```bash
export SUPABASE_URL=https://tjwlmdadhtywffsoeulv.supabase.co
export SUPABASE_SERVICE_KEY=...   # the service_role key you copied
npm run smoke:supabase            # quick health check — should say PASS on every line
npm run dev
```

The database tables are already set up. Once this works, your vault survives anything happening to this computer.

**Step 4 — Put it on the internet (so your phone works anywhere).**
This uses Fly.io (has a free tier). Install their tool from [fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/), then:

```bash
fly launch --copy-config --no-deploy
fly secrets set VAULT_KEY=pick-a-long-secret-password SUPABASE_URL=https://tjwlmdadhtywffsoeulv.supabase.co SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=...
fly deploy
```

Fly gives you a web address like `https://your-app.fly.dev`. Open it anywhere — on your phone, add `?server=https://your-app.fly.dev&key=your-secret-password` the first time. Pick a long, random `VAULT_KEY`: it is the password to your entire vault.

**Step 5 — Let the assistant use your computer.**
When you want the assistant to be able to run things on your laptop (from your phone, by voice), run this on the laptop and leave it open:

```bash
npm run node-harness -- --server wss://your-app.fly.dev
```

Every command it wants to run shows an **Approve / Deny** card on your screen first. There's also a pause switch under **Devices** in the sidebar that stops the assistant everywhere, instantly.

**Step 6 — Your notes are always yours.**
Settings (gear icon) → **Export vault** downloads everything as a zip of plain Markdown files at any time.

**What still needs a developer:** publishing the desktop app installers (needs an Apple developer account) and the iPhone App Store version (needs a Mac with Xcode). Everything else above you can do yourself.

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

**iPhone (App Store / TestFlight)** — a Capacitor iOS app wrapping the same client lives in `ios/`. On first launch it shows a connect screen (server URL + vault key), then behaves exactly like the phone surface — same vault, same continuity, voice included. Building/submitting requires a Mac:

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
