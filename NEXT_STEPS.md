# Next steps → production

Working checklist for upcoming sessions. State of the world: the prototype is feature-complete and
covered by `npm run e2e` (39 checks, keyless via the mock engine) plus `npm run test:auth`
(11 offline accounts-mode checks), `npm run test:oauth` (8 offline connector-OAuth checks), and
`npm run test:automations` (23 offline custom-learning checks: scheduler, sandbox, memory, reflection).

## Custom learning — shipped, follow-ups

Automations (non-model scheduler + script sandbox), memory, and daily reflection are in
(see README "Custom learning"). Deliberately deferred:

- [x] Delivery to a pocketed phone: the iOS app mirrors reminder schedules into **local
      notifications** (computed on-device from synced automation files via `shared/schedule.mjs`) —
      they fire with the app closed, no APNs; live `notify()` events also raise system notifications
      on backgrounded surfaces (native + web Notification API). Bell toggle on the phone surface.
- [ ] Remote push (APNs / Web Push) for *conditional* script output — a `notify()` behind an `if`
      can't be precomputed on the device; needs Apple Developer account + a push relay on the server
- [ ] Timezone UI: scheduler honors `.vault/settings.json` `timezone` / `VAULT_TIMEZONE`; add a
      Settings picker so users don't edit JSON
- [ ] Trust boundary marker: automation scripts run in a node:vm sandbox with op/time caps — fine
      for self-host/prototype; a hosted multi-tenant deploy should move them to isolated workers
- [ ] Phase 3 (voice identity: wake word + on-device speaker verification) — parked by decision

## 0. Pricing & billing — NEXT UP

The goal: sell Vault as a subscription. Accounts + per-user vaults already exist, so billing is
"attach a plan to a user and enforce it." The plan, in build order:

- [ ] **Stripe foundation**: Stripe account (owner creates it, free) → products/prices (e.g. Free,
      Pro monthly, Pro yearly) → `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` env on the server
- [ ] **Checkout + portal**: `/api/billing/checkout` (Stripe Checkout session for the signed-in
      user) and `/api/billing/portal` (Stripe's hosted manage/cancel page) — Stripe hosts all
      payment UI, we never touch card data
- [ ] **Webhook → entitlements**: `/api/billing/webhook` consumes `checkout.session.completed` /
      `customer.subscription.updated|deleted` and writes a `plan` + `status` onto the user's vault
      row (new `plan` column, migration) — the server already loads that row on every connection
- [ ] **Enforcement**: per-plan limits checked where turns start — e.g. Free: N assistant turns/day,
      1 connector, no node harness; Pro: unlimited turns (fair-use rate limit stays), unlimited
      connectors, exec. Limits live in one table in code so pricing changes are one edit
- [ ] **UI**: plan badge + Upgrade button in Settings; friendly "you've used today's free turns"
      message in chat when a limit hits (upsell, not a wall)
- [ ] **Model economics decision** (owner): bundled AI (your `ANTHROPIC_API_KEY`, price covers
      tokens — simplest for buyers) vs bring-your-own-key (they set their key, you charge for the
      product — zero token risk) vs both (BYOK on Free, bundled on Pro). Recommended: both
- [ ] **Offline test**: `npm run test:billing` with a mock Stripe webhook (same pattern as
      test-auth/test-oauth) — entitlement changes, limit enforcement, downgrade behavior Everything below is what stands
between this and something strangers can download and trust.

## 1. Validate the real model path (first — everything else builds on it)
- [ ] Smoke-test the Anthropic engine with a real `ANTHROPIC_API_KEY` (streaming, tool loop, adaptive
      thinking, `pause_turn`) — including the new conversation cache breakpoint (watch
      `usage.cache_read_input_tokens` climb across turns) and `output_config.effort` on low/high turns
- [ ] Smoke-test OpenAI / Gemini / Ollama through the OpenAI-compat engine (tool-call deltas, no-tools degradation)
- [ ] Verify model switching mid-thread with two real providers
- [ ] Add an e2e job that runs against real providers when keys are present (skip otherwise)
- [x] Token/cost hygiene: replay capped (40 messages / ~60k chars, with a pointer to the full
      transcript in the vault), outline truncation marker, prompt caching on the Anthropic system block

## 2. Trust boundary (all the `// TODO: trust boundary` markers)
- [x] Real auth: `VAULT_AUTH=accounts` — Supabase Auth (email+password) sign-in, server-side JWT
      verification (local HS256 via `SUPABASE_JWT_SECRET`, or GoTrue), one isolated vault per user,
      per-vault presence/approvals/modes/kill-switch; covered offline by `npm run test:auth` (11 checks).
      Magic-link/passkey UIs and password reset still open
- [ ] Device registration + attestation: server-issued device tokens (capabilities are now assigned
      server-side from device type, but the *type* is still client-declared — pairing/approval of new
      devices is the remaining piece)
- [x] Per-command approval for `run_command` (voice-initiated, screen-confirmed: approve on any trusted surface)
- [x] Permission modes, Claude-style — Ask first / Auto / Read-only; default chosen in Settings,
      stored vault-wide (`.vault/settings.json`) so every device and session agrees
- [x] Command allowlist (`--allow git,npm,...`), workspace confinement, and a JSONL audit log of
      every exec (`~/.vault-node/audit.jsonl`) in the node harness
- [x] Kill switch: pause the agent from any surface (Devices panel); per-device revocation still open
- [x] Scope connector tools: per-connector Ask first / Trusted policy, screen-confirmed through the
      same approval cards as commands (vault-wide Auto mode bypasses, consistent with commands)
- [x] Connector OAuth tokens encrypted at rest (AES-256-GCM via `server/secrets.mjs`; set
      `VAULT_SECRET_KEY` on stateless deploys); user-pasted static tokens still plain — migrate them
- [x] Rate limiting (token bucket per connection) + input size caps (2 MB WS payload, 1.5 MB file,
      32k turn text); CORS restrictable via `VAULT_ALLOWED_ORIGINS`

## 3. Cloud backend for real multi-user use
- [x] Swap the JSON-file VaultStore for Supabase Postgres — `server/store-supabase.mjs`
      (write-through mirror, hydrate on boot; enable with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`;
      schema live on the project + in `supabase/migrations/`; verify with `npm run smoke:supabase`
      from a network that can reach *.supabase.co — the dev sandbox can't)
- [x] Multi-vault data model (`vaults` + `vault_id` on every record, keyed by hashed vault key
      or `owner_id`); multi-user accounts live via `VAULT_AUTH=accounts` (server is fully
      multi-tenant: per-vault contexts, no cross-vault broadcasts)
- [ ] Supabase Realtime/Presence/Auth to replace the WS server for serverless deploys
      (single-writer server + WS remains the architecture until then)
- [ ] Blob/attachment storage for non-Markdown files (images in notes)
- [x] Export: whole vault as a zip of plain Markdown (`/api/export`, button in Settings);
      scheduled off-site backups still open
- [x] Deploy story: one-container Dockerfile (client + API + WS) + `fly.toml`; README "Deploy"
      section covers secrets, CORS lockdown, and pointing devices at the deployed URL

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
- [x] Conflict UX: a write that loses last-write-wins is saved as an Obsidian-style
      "(conflicted copy …)" file instead of vanishing
- [x] Offline indicator surfaces pending-write count (sync dot in the sidebar); outbox
      already flushes on reconnect
- [x] Tombstone compaction (30-day TTL at boot, both stores); paginated initial sync for
      large vaults still open
- [ ] Multi-tab same-device coordination (SharedWorker or leader election)

## 7. Product polish
- [ ] Chat: stop/regenerate buttons, message actions (copy), day separators, unread state on other devices
- [ ] Editor: live block-style editing (Notion-like) instead of raw-source Edit tab; drag-drop in tree
- [x] Search (cmd-K palette across notes + chats, title + content, keyboard-driven)
- [ ] Graph: local-graph mode for the open note, zoom controls
- [x] Connectors: Claude-style gallery (curated hosted MCP catalog) + full OAuth flow
      (discovery, dynamic client registration, PKCE, refresh-on-401, encrypted token storage,
      one-click Connect popup); covered offline by `npm run test:oauth` (8 checks).
      Per-tool toggles within a connector still open
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
