# Vault

An AI-native workspace: an Obsidian-style vault that lives in the cloud, syncs in real time across genuinely separate devices, and has an assistant that is a first-class inhabitant of the vault — not a chat box bolted on.

**The two things that are the point:**

1. **Cross-session / cross-device continuity.** The vault and every conversation persist in the cloud and sync live to every connected device, each of which keeps a fast local IndexedDB cache. Close the tab, switch from phone to laptop — everything is exactly as left. Chats are folders; each turn is a Markdown file with frontmatter (`role`, `timestamp`, `device`, `provider`, `model`, `tools_used`). Resuming a session is just re-reading those records — there is no separate session database that can drift from the vault.
2. **Implicit device-awareness.** Each client registers with a cloud presence registry, advertising a device descriptor (type + capabilities). The assistant's tools are assembled **per-turn from which devices are currently present**: with only the phone connected the toolset is conversational (+ voice); the moment a desktop comes online, vault-editing tools exist. The model is never told which device is active and never announces it — capability simply changes because presence changed.

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

npm run dev     # cloud backend on :8787 + Vite on :5173
```

Open **`http://localhost:5173/?surface=desktop`** on your laptop and **`http://<lan-ip>:5173/?surface=phone`** on your phone (or a second machine/browser). Both attach to the same vault via a shared vault key (`VAULT_KEY`, default `vault-dev-key`; pass `?key=...` on the URL for non-default keys).

Production-ish: `npm run build && npm start` serves the built client and the API from one process on `:8787`.

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
│ React UI (tree/editor/graph) │  WS    │ VaultStore     canonical records    │
│ Dexie/IndexedDB cache        │◀──────▶│ Presence       device registry      │
│ SyncProvider (outbox, LWW)   │        │ Harness        session log,        │
└──────────────────────────────┘        │                per-turn tool       │
┌─ device: phone ──────────────┐        │                assembly            │
│ Chat + voice surface         │◀──────▶│ ModelEngines   anthropic │ openai  │
│ Dexie/IndexedDB cache        │  WS    │  (stateless)   gemini │ ollama │…  │
└──────────────────────────────┘        └─────────────────────────────────────┘
```

- **Engines are stateless and swappable; the harness is stateful and singular.** The harness owns the conversation (vault records), presence, and tool assembly; every engine gets the same neutral context (`system`, `messages`, `tools`, `executeTool`) — so swapping models mid-thread loses nothing. Adding a provider = implementing one engine (`server/engines/`).
- **The cloud layer is a seam.** `server/store.mjs` + the WS protocol in `src/lib/sync.ts` play the Supabase role (Postgres/Realtime/Presence). Swapping in Supabase means replacing those two files; the record model (path, type, content, timestamps, rev) maps 1:1 to a table.
- **Voice** is Web Speech API behind a `VoiceEngine` interface (`src/lib/voice.ts`) — swap for Deepgram/realtime later. Voice-initiated, screen-confirmed: speak on the phone, watch edits land on the desktop.
- **Sync** is last-write-wins per record with a monotonic rev cursor, tombstoned deletes, and a durable offline outbox on each client.

## Security posture (prototype)

Auth is a shared vault key — enough to make "separate devices, one vault" real, nothing more. The trust boundary is a real seam and is marked `// TODO: trust boundary` where a production build needs device attestation, scoped per-device capability grants (server-issued, not client-declared), and a kill switch. A voice-triggered agent with vault access across devices is a high-value target; don't expose this prototype to the internet as-is.
