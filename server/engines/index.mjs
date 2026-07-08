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

// Machine jobs (automation prompt-window edits, reflection, future title/
// summary work) never talk to the user — route them to the cheapest capable
// model instead of whatever the chat happens to be on. Only Anthropic gets
// remapped; other providers keep the caller's model (we don't know their
// catalogs' cheap tier).
export function utilityModelFor(provider, requestedModel) {
  if (provider === 'anthropic') return process.env.VAULT_UTILITY_MODEL || 'claude-haiku-4-5';
  return requestedModel;
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
    async run({ system, messages, tools, executeTool, onEvent }) {
      const last = messages[messages.length - 1]?.content ?? '';
      const toolsUsed = [];
      const say = async (text) => {
        for (const word of text.split(/(?<= )/)) {
          onEvent({ type: 'text', text: word });
          await new Promise((r) => setTimeout(r, 5));
        }
        return text;
      };

      // Automation editor calls (the Automations view's prompt window):
      // deterministically turn "remind me to X (daily) at HH:MM" into a file.
      if ((system || '').includes('automation editor for Vault')) {
        const time = last.match(/at (\d{1,2}):(\d{2})/);
        const hhmm = time ? `${time[1].padStart(2, '0')}:${time[2]}` : '09:00';
        const what = (last.match(/remind me to ([^.,\n]+)/i)?.[1] ?? last)
          .replace(/ at \d{1,2}:\d{2}.*$/, '')
          .trim()
          .slice(0, 60);
        const name = what.charAt(0).toUpperCase() + what.slice(1);
        const text = [
          '---',
          `name: ${JSON.stringify(name)}`,
          `description: ${JSON.stringify(`Reminds you to ${what}.`)}`,
          `schedule: daily ${hhmm}`,
          'enabled: true',
          'status: active',
          'created_by: user',
          '---',
          '',
          `Every day at ${hhmm}, this sends you a reminder to ${what}.`,
          '',
          '```js',
          `notify(${JSON.stringify(`Reminder: ${what}`)});`,
          '```',
        ].join('\n');
        return { text, toolsUsed };
      }

      // Reflection calls: propose an automation for any "remind me to X"
      // intent that appears 2+ times in the recent transcript.
      if ((system || '').includes('reflection process of Vault')) {
        const counts = new Map();
        for (const m of last.matchAll(/remind me to ([^.,\n\]]+)/gi)) {
          const key = m[1].trim().toLowerCase();
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const repeated = [...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k);
        const payload = {
          observations: repeated.map((w) => `User repeatedly asks to be reminded to ${w}.`),
          automations: repeated.map((w) => ({
            name: `Remind: ${w}`,
            description: `Reminds you to ${w}.`,
            schedule: 'daily 09:00',
            about: `Every day at 09:00, this sends you a reminder to ${w}.`,
            script: `notify(${JSON.stringify(`Reminder: ${w}`)});`,
          })),
        };
        return { text: JSON.stringify(payload), toolsUsed };
      }

      // Diagnostics: prove the harness wires skills/instructions into the
      // turn without needing a real model.
      if (/^\//.test(last.trim())) {
        const skillMatch = (system || '').match(/invoked the "([^"]+)" skill/);
        const text = await say(
          skillMatch
            ? `Skill loaded: ${skillMatch[1]} — following its instructions.`
            : `No skill matches ${last.trim().split(/\s/)[0]}.`
        );
        return { text, toolsUsed };
      }
      if (/^diagnostic: agent-file/i.test(last.trim())) {
        const has = (system || '').includes('.vault/AGENT.md');
        const text = await say(`agent-file: ${has ? 'yes' : 'no'}`);
        return { text, toolsUsed };
      }
      if (/^diagnostic: memory/i.test(last.trim())) {
        const idx = (system || '').indexOf('Your memory of this user');
        const text = await say(`memory: ${idx === -1 ? 'no' : (system || '').slice(idx, idx + 600).replace(/\n/g, ' ')}`);
        return { text, toolsUsed };
      }

      // Deterministic behaviors so tests can exercise the tool loop.
      const automateMatch = last.match(/^automate[:,]? (.+)$/i);
      const rememberMatch = last.match(/^remember[:,]? (.+)$/i);
      if (rememberMatch && tools.some((t) => t.name === 'save_memory')) {
        onEvent({ type: 'tool_start', name: 'save_memory', input: { note: rememberMatch[1] } });
        toolsUsed.push('save_memory');
        await executeTool('save_memory', { note: rememberMatch[1] });
        onEvent({ type: 'tool_result', name: 'save_memory', ok: true });
        return { text: await say(`Got it — I'll remember that.`), toolsUsed };
      }
      if (automateMatch && tools.some((t) => t.name === 'save_automation')) {
        const time = automateMatch[1].match(/at (\d{1,2}):(\d{2})/);
        const hhmm = time ? `${time[1].padStart(2, '0')}:${time[2]}` : '09:00';
        const what = automateMatch[1].replace(/ at \d{1,2}:\d{2}.*$/, '').trim();
        const input = {
          name: what.charAt(0).toUpperCase() + what.slice(1),
          description: `Reminds you to ${what}.`,
          schedule: `daily ${hhmm}`,
          about: `Every day at ${hhmm}, this sends you a reminder to ${what}.`,
          script: `notify(${JSON.stringify(`Reminder: ${what}`)});`,
        };
        onEvent({ type: 'tool_start', name: 'save_automation', input });
        toolsUsed.push('save_automation');
        try {
          await executeTool('save_automation', input);
          onEvent({ type: 'tool_result', name: 'save_automation', ok: true });
          return { text: await say(`Done — that's now a standing automation (daily ${hhmm}).`), toolsUsed };
        } catch (err) {
          onEvent({ type: 'tool_result', name: 'save_automation', ok: false });
          return { text: await say(`No automation saved: ${err.message}`), toolsUsed };
        }
      }
      const noteMatch = last.match(/create (?:a )?note (?:called |named )?["']?([\w./ -]+?)["']?(?: with content ["'](.+?)["'])?$/i);
      const cmdMatch = last.match(/run (?:the )?command[: ]+(.+)$/i);
      const fetchMatch = last.match(/fetch (https?:\/\/\S+)/i);
      const connectorMatch = last.match(/connector .*?say (.+)$/i);
      const connectorTool = tools.find((t) => t.name.startsWith('c_'));
      const canWrite = tools.some((t) => t.name === 'create_note');
      const canExec = tools.some((t) => t.name === 'run_command');
      let text = '';
      if (connectorMatch && connectorTool) {
        onEvent({ type: 'tool_start', name: connectorTool.name, input: { text: connectorMatch[1] } });
        toolsUsed.push(connectorTool.name);
        try {
          const output = await executeTool(connectorTool.name, { text: connectorMatch[1] });
          onEvent({ type: 'tool_result', name: connectorTool.name, ok: true });
          text = await say(`The connector says: ${String(output).slice(0, 300)}`);
        } catch (err) {
          onEvent({ type: 'tool_result', name: connectorTool.name, ok: false });
          text = await say(`The connector didn't answer: ${err.message}`);
        }
      } else if (fetchMatch && tools.some((t) => t.name === 'fetch_url')) {
        onEvent({ type: 'tool_start', name: 'fetch_url', input: { url: fetchMatch[1] } });
        toolsUsed.push('fetch_url');
        try {
          const output = await executeTool('fetch_url', { url: fetchMatch[1] });
          onEvent({ type: 'tool_result', name: 'fetch_url', ok: true });
          text = await say(`Here's what that page says: ${String(output).slice(0, 300)}`);
        } catch (err) {
          onEvent({ type: 'tool_result', name: 'fetch_url', ok: false });
          text = await say(`I couldn't fetch that: ${err.message}`);
        }
      } else if (cmdMatch && canExec) {
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
