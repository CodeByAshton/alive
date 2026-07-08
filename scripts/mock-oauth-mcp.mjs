// Mock OAuth-protected MCP server for tests: a complete, tiny OAuth 2.1
// authorization server (discovery, dynamic client registration, PKCE code
// flow, refresh grant) in front of an MCP endpoint that requires a Bearer
// token. Auto-approves the consent screen so the whole flow runs headless.

import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT || 8976);
const BASE = `http://localhost:${PORT}`;

const codes = new Map(); // code -> { challenge, redirectUri }
let accessToken = `at-${crypto.randomBytes(8).toString('hex')}`;
const refreshToken = `rt-${crypto.randomBytes(8).toString('hex')}`;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function json(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, BASE);

    // ---- discovery ----
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json(res, 200, { resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: BASE,
        authorization_endpoint: `${BASE}/authorize`,
        token_endpoint: `${BASE}/token`,
        registration_endpoint: `${BASE}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
      });
    }

    // ---- dynamic client registration ----
    if (url.pathname === '/register' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(res, 201, { client_id: 'mock-client', redirect_uris: body.redirect_uris });
    }

    // ---- authorize: auto-approve, redirect back with a code ----
    if (url.pathname === '/authorize') {
      const code = `code-${crypto.randomBytes(8).toString('hex')}`;
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge'),
        redirectUri: url.searchParams.get('redirect_uri'),
      });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    // ---- token endpoint: code exchange (PKCE-verified) + refresh ----
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      if (params.get('grant_type') === 'authorization_code') {
        const grant = codes.get(params.get('code'));
        if (!grant) return json(res, 400, { error: 'invalid_grant' });
        codes.delete(params.get('code'));
        const expected = b64url(crypto.createHash('sha256').update(params.get('code_verifier') || '').digest());
        if (expected !== grant.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        return json(res, 200, { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600 });
      }
      if (params.get('grant_type') === 'refresh_token') {
        if (params.get('refresh_token') !== refreshToken) return json(res, 400, { error: 'invalid_grant' });
        accessToken = `at-${crypto.randomBytes(8).toString('hex')}`; // rotate
        return json(res, 200, { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600 });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    // ---- test hook: rotate the access token to simulate expiry ----
    if (url.pathname === '/rotate') {
      accessToken = `at-${crypto.randomBytes(8).toString('hex')}`;
      return json(res, 200, { ok: true });
    }

    // ---- the MCP endpoint itself: Bearer required ----
    if (url.pathname === '/mcp' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${accessToken}`) {
        return json(res, 401, { error: 'unauthorized' }, {
          'www-authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
        });
      }
      const msg = JSON.parse(await readBody(req));
      const reply = (result) => json(res, 200, { jsonrpc: '2.0', id: msg.id, result }, { 'mcp-session-id': 'mock-oauth-session' });
      switch (msg.method) {
        case 'initialize':
          return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-oauth-mcp', version: '0.1.0' } });
        case 'notifications/initialized':
          res.writeHead(202);
          return res.end();
        case 'tools/list':
          return reply({
            tools: [{ name: 'whoami', description: 'Who is signed in.', inputSchema: { type: 'object', properties: {} } }],
          });
        case 'tools/call':
          return reply({ content: [{ type: 'text', text: 'signed-in-user: tester' }] });
        default:
          return reply({});
      }
    }

    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`mock oauth mcp on :${PORT}`));
