// ModelEngine implementation: Anthropic (Claude) via the official SDK.
// Contract (same for every engine):
//   run({ model, system, messages, tools, executeTool, onEvent }) -> { text, toolsUsed }
// - messages: neutral [{ role: 'user'|'assistant', content: string }]
// - tools:    neutral [{ name, description, input_schema }]
// - executeTool(name, input) -> Promise<string>
// - onEvent:  ({type:'text',text} | {type:'tool_start',name,input} | {type:'tool_result',name,ok})
// The engine owns its provider-native tool loop; the harness stays provider-agnostic.

import Anthropic from '@anthropic-ai/sdk';

const ADAPTIVE_THINKING = new Set(['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-sonnet-4-6']);
const MAX_ITERATIONS = 8;

export function createAnthropicEngine() {
  let client = null;
  return {
    id: 'anthropic',
    async run({ model, system, messages, tools, executeTool, onEvent }) {
      client ??= new Anthropic();
      const providerMessages = messages.map((m) => ({ role: m.role, content: m.content }));
      const providerTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
      // Anthropic's server-side web search: real search results with
      // citations, executed by the API (billed per search). fetch_url in the
      // harness covers direct page reads for every provider; this adds
      // actual searching for Claude. Disable with VAULT_WEB_SEARCH=0.
      if (process.env.VAULT_WEB_SEARCH !== '0') {
        providerTools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
      }

      const toolsUsed = [];
      let finalText = '';

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const params = {
          model,
          max_tokens: 16000,
          // Cache the system prompt (instructions + vault outline + standing
          // instructions) — it's the bulk of every turn and identical across
          // the tool loop, so this cuts cost/latency substantially.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: providerMessages,
        };
        if (ADAPTIVE_THINKING.has(model)) params.thinking = { type: 'adaptive' };
        if (providerTools.length) params.tools = providerTools;

        const stream = client.messages.stream(params);
        stream.on('text', (delta) => {
          finalText += delta;
          onEvent({ type: 'text', text: delta });
        });
        const response = await stream.finalMessage();

        if (response.stop_reason === 'pause_turn') {
          providerMessages.push({ role: 'assistant', content: response.content });
          continue;
        }
        if (response.stop_reason !== 'tool_use') break;

        providerMessages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolsUsed.push(block.name);
          onEvent({ type: 'tool_start', name: block.name, input: block.input });
          let result, isError = false;
          try {
            result = await executeTool(block.name, block.input);
          } catch (err) {
            result = `Error: ${err.message}`;
            isError = true;
          }
          onEvent({ type: 'tool_result', name: block.name, ok: !isError });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: String(result ?? 'ok'),
            ...(isError ? { is_error: true } : {}),
          });
        }
        providerMessages.push({ role: 'user', content: toolResults });
        if (finalText) {
          finalText += '\n\n';
          onEvent({ type: 'text', text: '\n\n' });
        }
      }

      return { text: finalText, toolsUsed };
    },
  };
}
