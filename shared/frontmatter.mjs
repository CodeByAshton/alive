// YAML frontmatter parser/serializer shared by server and client.
// Covers the YAML subset Obsidian actually uses for properties — typed
// scalars, quoted strings, flow sequences [a, b], block sequences (- item) —
// without a YAML dependency. Values that came from JSON.stringify (older
// records) remain valid YAML and keep parsing.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s.startsWith("'") ? '"' + s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' : s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseValue(raw) {
  const s = raw.trim();
  // JSON is valid YAML — covers legacy JSON-encoded values and objects.
  if (s.startsWith('{') || s.startsWith('[') || s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      /* fall through */
    }
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(parseScalar);
  }
  return parseScalar(raw);
}

export function parseFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---\n')) {
    return { data: {}, body: text ?? '' };
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const data = {};
  let pendingListKey = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    // block sequence item under the previous key
    const itemMatch = line.match(/^\s+-\s?(.*)$/) || (pendingListKey && line.match(/^-\s?(.*)$/));
    if (itemMatch && pendingListKey) {
      if (!Array.isArray(data[pendingListKey])) data[pendingListKey] = [];
      data[pendingListKey].push(parseScalar(itemMatch[1]));
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (!key) continue;
    if (rest === '') {
      // could be the start of a block sequence; resolves to null if no items follow
      data[key] = null;
      pendingListKey = key;
    } else {
      data[key] = parseValue(rest);
      pendingListKey = null;
    }
  }
  return { data, body };
}

const BARE_SAFE = /^[A-Za-z][\w ./@-]*$/;

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (BARE_SAFE.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map(yamlScalar).join(', ')}]`;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return yamlScalar(value);
}

export function serializeFrontmatter(data, body) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
