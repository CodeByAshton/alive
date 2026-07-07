// Minimal YAML-ish frontmatter parser/serializer shared by server and client.
// Values are JSON-encoded on write so arrays/objects round-trip without a YAML dep.

export function parseFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---\n')) {
    return { data: {}, body: text ?? '' };
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  const data = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    try {
      data[key] = JSON.parse(value);
    } catch {
      data[key] = value;
    }
  }
  return { data, body };
}

export function serializeFrontmatter(data, body) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' && !/[\n:]/.test(v) ? v : JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
