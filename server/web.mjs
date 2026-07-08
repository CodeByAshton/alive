// Web access for the harness: fetch a public page and return readable text.
// Guarded against SSRF — the assistant must not be able to use the vault
// server as a periscope into private networks (cloud metadata endpoints,
// localhost admin panels, the LAN). Every hop of every redirect re-checks
// the target address. VAULT_FETCH_ALLOW=host1,host2 whitelists specific
// private hosts (used by tests; useful for homelab setups).

import { lookup } from 'node:dns/promises';
import net from 'node:net';

const ALLOW_HOSTS = (process.env.VAULT_FETCH_ALLOW || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_BYTES = 512 * 1024; // read cap
const MAX_TEXT = 20_000; // what the model sees
const MAX_HOPS = 5;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7)); // v4-mapped
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicHost(hostname) {
  if (ALLOW_HOSTS.includes(hostname)) return;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('That address is on a private network and not reachable from here.');
    return;
  }
  let addrs;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`Couldn't resolve ${hostname}.`);
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('That address is on a private network and not reachable from here.');
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function fetchUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Only http(s) URLs can be fetched (got ${url.protocol}).`);
    }
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'VaultAssistant/0.1 (+fetch_url tool)', accept: 'text/html,text/*;q=0.9,*/*;q=0.5' },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url); // re-checked next hop
      continue;
    }
    if (!res.ok) throw new Error(`The page answered with HTTP ${res.status}.`);

    // Read up to the byte cap, then stop.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');

    const type = res.headers.get('content-type') || '';
    const text = /html/i.test(type) ? htmlToText(body) : body.trim();
    if (!text) return '(the page had no readable text)';
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(truncated at ${MAX_TEXT} chars)` : text;
  }
  throw new Error('Too many redirects.');
}
