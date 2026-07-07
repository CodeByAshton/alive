// ModelEngine registry. Adding a provider = one entry here implementing the
// engine contract (see anthropic.mjs). The harness never knows which provider
// is active — switching models mid-conversation keeps the same session context.

import { createAnthropicEngine } from './anthropic.mjs';
import { createOpenAICompatEngine } from './openaiCompat.mjs';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const engines = {
  anthropic: createAnthropicEngine(),
  openai: createOpenAICompatEngine({
    id: 'openai',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  }),
  gemini: createOpenAICompatEngine({
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.GEMINI_API_KEY,
  }),
  ollama: createOpenAICompatEngine({
    id: 'ollama',
    baseUrl: `${OLLAMA_URL}/v1`,
    apiKey: 'ollama',
  }),
  // 'mock' engine: lets the whole harness run (streaming, tool use, sync)
  // with zero API keys — useful for demos and automated tests.
  mock: createMockEngine(),
};

export function getEngine(provider) {
  const engine = engines[provider];
  if (!engine) throw new Error(`Unknown provider: ${provider}`);
  return engine;
}

export async function listProviders() {
  const providers = [
    {
      id: 'anthropic',
      label: 'Anthropic',
      available: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      available: Boolean(process.env.OPENAI_API_KEY),
      models: (process.env.OPENAI_MODELS || 'gpt-5,gpt-4o').split(','),
    },
    {
      id: 'gemini',
      label: 'Google',
      available: Boolean(process.env.GEMINI_API_KEY),
      models: (process.env.GEMINI_MODELS || 'gemini-2.5-pro,gemini-2.5-flash').split(','),
    },
    {
      id: 'ollama',
      label: 'Ollama',
      available: false,
      models: [],
    },
  ];

  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const json = await res.json();
      const ollama = providers.find((p) => p.id === 'ollama');
      ollama.models = (json.models || []).map((m) => m.name);
      ollama.available = ollama.models.length > 0;
    }
  } catch {
    /* no local ollama server */
  }

  if (process.env.VAULT_ENABLE_MOCK === '1') {
    providers.push({ id: 'mock', label: 'Mock (dev)', available: true, models: ['mock-1'] });
  }
  return providers;
}

function createMockEngine() {
  return {
    id: 'mock',
    async run({ messages, tools, executeTool, onEvent }) {
      const last = messages[messages.length - 1]?.content ?? '';
      const toolsUsed = [];
      const say = async (text) => {
        for (const word of text.split(/(?<= )/)) {
          onEvent({ type: 'text', text: word });
          await new Promise((r) => setTimeout(r, 5));
        }
        return text;
      };

      // Deterministic behaviors so tests can exercise the tool loop.
      const noteMatch = last.match(/create (?:a )?note (?:called |named )?["']?([\w./ -]+?)["']?(?: with content ["'](.+?)["'])?$/i);
      const cmdMatch = last.match(/run (?:the )?command[: ]+(.+)$/i);
      const canWrite = tools.some((t) => t.name === 'create_note');
      const canExec = tools.some((t) => t.name === 'run_command');
      let text = '';
      if (cmdMatch && canExec) {
        onEvent({ type: 'tool_start', name: 'run_command', input: { command: cmdMatch[1] } });
        toolsUsed.push('run_command');
        try {
          const output = await executeTool('run_command', { command: cmdMatch[1] });
          onEvent({ type: 'tool_result', name: 'run_command', ok: true });
          text = await say(`Ran it. Output:\n\n\`\`\`\n${String(output).slice(0, 500)}\n\`\`\``);
        } catch (err) {
          onEvent({ type: 'tool_result', name: 'run_command', ok: false });
          text = await say(`The command failed: ${err.message}`);
        }
      } else if (cmdMatch && !canExec) {
        text = await say(`Noted — I'll run \`${cmdMatch[1]}\` as soon as I'm able to; for now let's keep planning.`);
      } else if (noteMatch && canWrite) {
        const name = noteMatch[1].trim().replace(/\.md$/, '');
        const path = name.includes('/') ? `${name}.md` : `notes/${name}.md`;
        onEvent({ type: 'tool_start', name: 'create_note', input: { path } });
        toolsUsed.push('create_note');
        try {
          await executeTool('create_note', { path, content: noteMatch[2] || `Created by mock engine.` });
          onEvent({ type: 'tool_result', name: 'create_note', ok: true });
          text = await say(`Done — I created [[${name.split('/').pop()}]] for you.`);
        } catch (err) {
          onEvent({ type: 'tool_result', name: 'create_note', ok: false });
          text = await say(`I couldn't create the note: ${err.message}`);
        }
      } else if (noteMatch && !canWrite) {
        text = await say(
          `Happy to help with "${noteMatch[1].trim()}" — let's sketch what should go in it and I'll set it up when I can make edits.`
        );
      } else {
        text = await say(`Mock reply (${tools.length} tools available): ${last.slice(0, 120)}`);
      }
      return { text, toolsUsed };
    },
  };
}
