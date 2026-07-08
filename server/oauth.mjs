// MCP OAuth client — the "just click Authenticate" flow, Claude-style.
// Given only an MCP server URL, this walks the whole spec:
//   1. discovery: protected-resource metadata -> authorization server metadata
//   2. dynamic client registration (RFC 7591, public client + PKCE)
//   3. authorization redirect (S256 challenge, state, RFC 8707 resource)
//   4. code exchange at the token endpoint; refresh-token grant thereafter
// Tokens are encrypted (secrets.mjs) into the connector's vault record, so
// clients and the database only ever hold ciphertext.

import crypto from 'node:crypto';
import { parseFrontmatter, serializeFrontmatter } from '../shared/frontmatter.mjs';
import { encryptSecret, decryptSecret, isEncryptedSecret } from './secrets.mjs';

const pendingFlows = new Map(); // state -> flow
const FLOW_TTL = 10 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Discovery: find the authorization server for an MCP endpoint, then its
// endpoints. Tries the modern protected-resource route first, then falls
// back to treating the MCP origin as the issuer (older servers).
async function discover(mcpUrl) {
  const u = new URL(mcpUrl);
  const origin = u.origin;

  let issuer = origin;
  for (const wk of [
    `${origin}/.well-known/oauth-protected-resource${u.pathname === '/' ? '' : u.pathname}`,
    `${origin}/.well-known/oauth-protected-resource`,
  ]) {
    try {
      const meta = await getJson(wk);
      if (meta.authorization_servers?.length) {
        issuer = meta.authorization_servers[0].replace(/\/$/, '');
        break;
      }
    } catch {
      /* try the next well-known location */
    }
  }

  const iss = new URL(issuer);
  const issPath = iss.pathname === '/' ? '' : iss.pathname;
  for (const wk of [
    `${iss.origin}/.well-known/oauth-authorization-server${issPath}`,
    `${iss.origin}/.well-known/oauth-authorization-server`,
    `${iss.origin}/.well-known/openid-configuration`,
  ]) {
    try {
      const meta = await getJson(wk);
      if (meta.authorization_endpoint && meta.token_endpoint) return meta;
    } catch {
      /* try the next well-known location */
    }
  }
  throw new Error("This server doesn't advertise an OAuth setup — it may use plain API tokens instead.");
}

async function registerClient(meta, redirectUri) {
  if (!meta.registration_endpoint) {
    throw new Error("This server doesn't support automatic app registration — it may need a pre-issued token.");
  }
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      client_name: 'Vault',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!res.ok) throw new Error(`Registration failed (HTTP ${res.status}).`);
  const client = await res.json();
  if (!client.client_id) throw new Error('Registration returned no client id.');
  return client.client_id;
}

function readConnectorRecord(store, connectorPath) {
  const rec = store.get(connectorPath);
  if (!rec) throw new Error('No such connector.');
  return { rec, ...parseFrontmatter(rec.content) };
}

function writeOauthField(store, connectorPath, oauthValue) {
  const { data, body } = readConnectorRecord(store, connectorPath);
  if (oauthValue === null) delete data.oauth;
  else data.oauth = oauthValue;
  store.put({ path: connectorPath, type: 'file', content: serializeFrontmatter(data, body) });
}

// Step 1+2+3: returns the URL to open in the user's browser.
export async function startFlow({ store, connectorPath, redirectUri }) {
  const { data } = readConnectorRecord(store, connectorPath);
  const mcpUrl = String(data.url || '');
  if (!mcpUrl) throw new Error('Set the connector URL first.');

  const meta = await discover(mcpUrl);
  const clientId = await registerClient(meta, redirectUri);

  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  pendingFlows.set(state, {
    store,
    connectorPath,
    verifier,
    clientId,
    tokenEndpoint: meta.token_endpoint,
    resource: mcpUrl,
    redirectUri,
    at: Date.now(),
  });
  // Expire stale flows.
  for (const [s, f] of pendingFlows) if (Date.now() - f.at > FLOW_TTL) pendingFlows.delete(s);

  const auth = new URL(meta.authorization_endpoint);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('resource', mcpUrl);
  if (meta.scopes_supported?.length) auth.searchParams.set('scope', meta.scopes_supported.join(' '));
  return auth.toString();
}

async function tokenRequest(endpoint, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token exchange failed (HTTP ${res.status}).`);
  }
  return json;
}

// Step 4: the provider redirected back — exchange the code, store tokens.
export async function completeFlow(state, code) {
  const flow = pendingFlows.get(state);
  if (!flow) throw new Error('This sign-in link expired — try Connect again.');
  pendingFlows.delete(state);

  const tokens = await tokenRequest(flow.tokenEndpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.verifier,
    resource: flow.resource,
  });

  writeOauthField(
    flow.store,
    flow.connectorPath,
    encryptSecret(
      JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        token_endpoint: flow.tokenEndpoint,
        client_id: flow.clientId,
        resource: flow.resource,
      })
    )
  );
}

export function disconnect(store, connectorPath) {
  writeOauthField(store, connectorPath, null);
}

export function readTokens(oauthBlob) {
  if (!isEncryptedSecret(oauthBlob)) return null;
  try {
    return JSON.parse(decryptSecret(oauthBlob));
  } catch {
    return null; // encrypted under a lost key — treat as not connected
  }
}

// Refresh-token grant; persists and returns the new token set (or null if
// this authorization can't be refreshed).
export async function refreshTokens(store, connectorPath, tokens) {
  if (!tokens?.refresh_token) return null;
  const next = await tokenRequest(tokens.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: tokens.client_id,
    resource: tokens.resource,
  });
  const updated = {
    ...tokens,
    access_token: next.access_token,
    refresh_token: next.refresh_token || tokens.refresh_token,
    expires_at: next.expires_in ? Date.now() + next.expires_in * 1000 : null,
  };
  writeOauthField(store, connectorPath, encryptSecret(JSON.stringify(updated)));
  return updated;
}
