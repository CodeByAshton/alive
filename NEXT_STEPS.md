# Next steps → production

Working checklist for upcoming sessions. State of the world: the prototype is feature-complete and
covered by `npm run e2e` (25 checks, keyless via the mock engine). Everything below is what stands
between this and something strangers can download and trust.

## 1. Validate the real model path (first — everything else builds on it)
- [ ] Smoke-test the Anthropic engine with a real `ANTHROPIC_API_KEY` (streaming, tool loop, adaptive thinking, `pause_turn`)
- [ ] Smoke-test OpenAI / Gemini / Ollama through the OpenAI-compat engine (tool-call deltas, no-tools degradation)
- [ ] Verify model switching mid-thread with two real providers
- [ ] Add an e2e job that runs against real providers when keys are present (skip otherwise)
- [ ] Token/cost hygiene: cap conversation replay length, trim vault outline, consider prompt caching on the system prompt

## 2. Trust boundary (all the `// TODO: trust boundary` markers)
- [ ] Replace the shared vault key with real auth (magic link or passkey; one vault per account)
- [ ] Device registration + attestation: server-issued device tokens, not client-declared capabilities
- [ ] Per-command approval for `run_command` (voice-initiated, screen-confirmed: approve on any trusted surface)
- [ ] Command allowlist / workspace confinement options in the node harness; audit log of every exec
- [ ] Kill switch: revoke a device / pause the agent from any surface
- [ ] Scope connector tools (per-connector allow/ask policy); never log tokens; encrypt secrets at rest
- [ ] Rate limiting + input size caps on the WS API; authenticated CORS instead of `*`

## 3. Cloud backend for real multi-user use
- [ ] Swap the JSON-file VaultStore for Postgres (or Supabase: Postgres + Realtime + Presence + Auth — the seams are `server/store.mjs` + `src/lib/sync.ts`)
- [ ] Multi-vault / multi-user data model (vault_id on every record)
- [ ] Blob/attachment storage for non-Markdown files (images in notes)
- [ ] Backups + export (zip of the vault = plain Markdown folder)
- [ ] Deploy story: Fly/Railway/VPS container for the vault server + TLS; document `VAULT_REMOTE`

## 4. Desktop app shipping
- [ ] First `npm run desktop` smoke test on a real Mac (Electron couldn't launch in the dev sandbox)
- [ ] macOS code signing + notarization in `.github/workflows/release.yml` (Developer ID cert secrets)
- [ ] Windows signing (or ship unsigned with SmartScreen caveat documented)
- [ ] Auto-update (electron-updater against GitHub Releases)
- [ ] Tray/menu-bar presence + launch-at-login for the node harness role
- [ ] Tag `v0.1.0` and verify the release workflow produces installers on all three OSes

## 5. iPhone app shipping
- [ ] Open `ios/` in Xcode, set the team, run on device (`npm run ios:sync && npx cap open ios`)
- [ ] App icon + splash (replace Capacitor defaults), display name, bundle id review
- [ ] Native niceties: keyboard avoidance, haptics on mic, background audio session for TTS
- [ ] Consider native speech (Capacitor plugin) over Web Speech for reliability on iOS
- [ ] TestFlight build → App Store listing (privacy manifest, review notes about the self-hosted server)

## 6. Sync robustness
- [ ] Conflict UX beyond last-write-wins (at minimum: conflicted-copy files like Obsidian)
- [ ] Outbox retry with backoff + offline indicator surfacing pending-write count
- [ ] Compaction of tombstones; paginated initial sync for large vaults
- [ ] Multi-tab same-device coordination (SharedWorker or leader election)

## 7. Product polish
- [ ] Chat: stop/regenerate buttons, message actions (copy), day separators, unread state on other devices
- [ ] Editor: live block-style editing (Notion-like) instead of raw-source Edit tab; drag-drop in tree
- [ ] Search (cmd-K palette across notes + chats)
- [ ] Graph: local-graph mode for the open note, zoom controls
- [ ] Connectors: OAuth flow for hosted MCP servers (Notion/Linear/etc.), per-tool toggles
- [ ] Skills: template gallery; test-run a skill from the editor
- [ ] Onboarding: first-run tour; QR code on desktop to open the phone surface pre-configured
- [ ] Mobile browser polish for the desktop surface (responsive breakpoints)

## 8. Website + distribution (deferred earlier)
- [ ] Landing page with download buttons wired to GitHub Releases latest
- [ ] Docs: self-hosting guide, node-harness guide, connector guide
- [ ] Pages deploy workflow

## Known gaps / debts
- Electron + shadcn registry hosts are blocked in the dev sandbox (binaries download fine in CI; shadcn components are vendored — `.mcp.json` registers the shadcn MCP for sessions where the network allows)
- `react-force-graph-2d` bundle is heavy → lazy-load the graph view
- Phone surface reuses the compact chat; native app deserves its own navigation shell
- Message frontmatter is the audit log; no server-side structured logging yet
