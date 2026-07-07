// The harness is stateful and singular: it owns the session log (chat folders
// in the vault), the device-presence registry, and per-turn tool assembly.
// Engines (models) are stateless and swappable — the harness hands each one
// the same session context, so switching models mid-thread loses nothing.

import { parseFrontmatter, serializeFrontmatter } from '../shared/frontmatter.mjs';
import { getEngine } from './engines/index.mjs';

const SYSTEM_PROMPT = `You are the resident assistant of Vault — a personal knowledge workspace where everything is a Markdown file in a folder tree, notes link to each other with [[wikilinks]], and your conversations with the user are themselves folders of Markdown files in the same vault.

You may have tools for reading and editing the vault. Use whatever tools are currently available to you; if a capability isn't available right now, work conversationally instead — discuss, plan, and remember, and simply carry the intent forward. Never mention, speculate about, or allude to which device the user is using, why your capabilities might vary, or that tools appeared or disappeared. Do not say things like "I notice you're on your phone" or "now that you're at your desk". Just behave appropriately.

When you edit the vault, narrate briefly what you're doing as you work (one short sentence per action), because the user may be listening rather than watching. Use [[wikilinks]] when referring to notes. Prefer creating notes under an appropriate existing folder. Keep responses concise.`;

const VAULT_TOOLS = [
  {
    name: 'list_files',
    description: 'List files and folders in the vault, optionally under a path prefix. Returns one path per line.',
    input_schema: { type: 'object', properties: { prefix: { type: 'string', description: 'Folder path prefix, e.g. "notes". Omit for the whole vault.' } } },
    capability: 'read',
  },
  {
    name: 'read_note',
    description: 'Read the contents of a file in the vault.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    capability: 'read',
  },
  {
    name: 'create_note',
    description: 'Create (or overwrite) a Markdown note at the given path. Path should end in .md.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    capability: 'write',
  },
  {
    name: 'edit_note',
    description: 'Replace the full contents of an existing note.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    capability: 'write',
  },
  {
    name: 'append_note',
    description: 'Append text to the end of an existing note (creates it if missing).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    capability: 'write',
  },
  {
    name: 'create_folder',
    description: 'Create a folder at the given path.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    capability: 'write',
  },
  {
    name: 'move_path',
    description: 'Move or rename a file or folder (and everything under it).',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    capability: 'write',
  },
  {
    name: 'delete_path',
    description: 'Delete a file or folder (and everything under it).',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    capability: 'write',
  },
];

function sanitizePath(p) {
  const clean = String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
  if (!clean || clean.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`Invalid path: ${p}`);
  }
  return clean;
}

// Tool assembly is driven by presence: the model is only ever handed the
// tools for currently-present devices. It is never told which devices those
// are — capability shows up purely as which tools exist this turn.
// TODO: trust boundary — a real version needs device attestation and scoped,
// signed capability grants here rather than trusting the client-declared
// device descriptor.
export function assembleTools(presence) {
  const active = presence.active();
  const capabilities = new Set(active.flatMap((d) => d.capabilities || []));
  return VAULT_TOOLS.filter((t) => capabilities.has(t.capability)).map(({ capability, ...t }) => t);
}

function makeToolExecutor(store) {
  return async function executeTool(name, input) {
    switch (name) {
      case 'list_files': {
        const prefix = input.prefix ? sanitizePath(input.prefix) : '';
        const rows = store
          .list(prefix)
          .map((r) => (r.type === 'folder' ? r.path + '/' : r.path))
          .sort();
        return rows.length ? rows.join('\n') : '(empty)';
      }
      case 'read_note': {
        const rec = store.get(sanitizePath(input.path));
        if (!rec || rec.type !== 'file') throw new Error(`No file at ${input.path}`);
        return rec.content;
      }
      case 'create_note':
      case 'edit_note': {
        const path = sanitizePath(input.path);
        store.put({ path, type: 'file', content: String(input.content ?? '') });
        return `Saved ${path}`;
      }
      case 'append_note': {
        const path = sanitizePath(input.path);
        const existing = store.get(path);
        const content = existing ? existing.content.replace(/\n?$/, '\n') + String(input.content ?? '') : String(input.content ?? '');
        store.put({ path, type: 'file', content });
        return `Appended to ${path}`;
      }
      case 'create_folder': {
        const path = sanitizePath(input.path);
        store.put({ path, type: 'folder' });
        return `Created folder ${path}`;
      }
      case 'move_path': {
        const from = sanitizePath(input.from);
        const to = sanitizePath(input.to);
        const changed = store.move(from, to);
        if (!changed.length) throw new Error(`Nothing at ${from}`);
        return `Moved ${from} -> ${to}`;
      }
      case 'delete_path': {
        const path = sanitizePath(input.path);
        const changed = store.delete(path);
        if (!changed.length) throw new Error(`Nothing at ${path}`);
        return `Deleted ${path}`;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}

function loadSkill(store, text) {
  const match = text.match(/^\/([\w-]+)\b/);
  if (!match) return null;
  const trigger = '/' + match[1].toLowerCase();
  for (const rec of store.list('skills')) {
    if (rec.type !== 'file' || !rec.path.endsWith('.md')) continue;
    const { data, body } = parseFrontmatter(rec.content);
    if (String(data.trigger || '').toLowerCase() === trigger) {
      return { name: data.name || match[1], trigger, instructions: body.trim(), path: rec.path };
    }
  }
  return null;
}

function readConversation(store, chatPath) {
  return store
    .list(chatPath)
    .filter((r) => r.type === 'file' && r.path.endsWith('.md') && r.path !== `${chatPath}/index.md`)
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((r) => {
      const { data, body } = parseFrontmatter(r.content);
      return { role: data.role === 'assistant' ? 'assistant' : 'user', content: body.trim() };
    })
    .filter((m) => m.content);
}

function nextSeq(store, chatPath) {
  const count = store
    .list(chatPath)
    .filter((r) => r.type === 'file' && /\/\d{4}-(user|assistant)\.md$/.test(r.path)).length;
  return String(count + 1).padStart(4, '0');
}

function vaultOutline(store) {
  const paths = store
    .list()
    .filter((r) => !r.path.startsWith('chats/'))
    .map((r) => (r.type === 'folder' ? r.path + '/' : r.path))
    .sort()
    .slice(0, 200);
  return paths.join('\n');
}

export async function runTurn({ store, presence, chatPath, text, deviceType, provider, model, broadcast }) {
  chatPath = sanitizePath(chatPath);
  const timestamp = new Date().toISOString();

  // 1. The user's turn becomes a Markdown file in the chat folder. Continuity
  // is just sync: these records are the session, there is no other log.
  const userSeq = nextSeq(store, chatPath);
  store.put({
    path: `${chatPath}/${userSeq}-user.md`,
    type: 'file',
    content: serializeFrontmatter({ role: 'user', timestamp, device: deviceType }, text),
  });

  // 2. Slash command? Load the skill (itself vault content) into this turn.
  const skill = loadSkill(store, text);

  // 3. Assemble tools from what's present *right now*.
  const tools = assembleTools(presence);

  // 4. Rebuild the conversation from the chat folder records.
  const messages = readConversation(store, chatPath);

  let system = SYSTEM_PROMPT + `\n\nCurrent vault contents (paths):\n${vaultOutline(store) || '(empty)'}`;
  if (skill) {
    system += `\n\nThe user invoked the "${skill.name}" skill (${skill.trigger}). Follow these skill instructions for this turn:\n${skill.instructions}`;
  }

  broadcast({ type: 'turn_started', chatPath, provider, model });

  const engine = getEngine(provider);
  let result;
  try {
    result = await engine.run({
      model,
      system,
      messages,
      tools,
      executeTool: makeToolExecutor(store),
      onEvent: (event) => {
        if (event.type === 'text') broadcast({ type: 'turn_delta', chatPath, text: event.text });
        else if (event.type === 'tool_start') broadcast({ type: 'turn_tool', chatPath, name: event.name, status: 'running' });
        else if (event.type === 'tool_result') broadcast({ type: 'turn_tool', chatPath, name: event.name, status: event.ok ? 'done' : 'error' });
      },
    });
  } catch (err) {
    broadcast({ type: 'turn_error', chatPath, error: err.message });
    return;
  }

  // 5. Persist the assistant turn with provenance: which model produced it,
  // which device surface initiated it, which tools ran.
  const assistantSeq = nextSeq(store, chatPath);
  store.put({
    path: `${chatPath}/${assistantSeq}-assistant.md`,
    type: 'file',
    content: serializeFrontmatter(
      {
        role: 'assistant',
        timestamp: new Date().toISOString(),
        device: deviceType,
        provider,
        model,
        tools_used: result.toolsUsed,
        ...(skill ? { skill: skill.trigger } : {}),
      },
      result.text.trim() || '(no response)'
    ),
  });

  broadcast({ type: 'turn_done', chatPath });
}
