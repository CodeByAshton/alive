// ModelEngine implementation: any OpenAI-compatible chat-completions API.
// One engine covers OpenAI, Google Gemini (its OpenAI-compat endpoint), and
// Ollama (/v1). Same contract as the Anthropic engine — see anthropic.mjs.

const MAX_ITERATIONS = 8;

export function createOpenAICompatEngine({ id, baseUrl, apiKey }) {
  return {
    id,
    async run({ model, system, messages, tools, executeTool, onEvent }) {
      const providerMessages = [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const providerTools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));

      const toolsUsed = [];
      let finalText = '';
      let useTools = providerTools.length > 0;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        let completion;
        try {
          completion = await streamCompletion({
            baseUrl, apiKey, model,
            messages: providerMessages,
            tools: useTools ? providerTools : undefined,
            onText: (delta) => {
              finalText += delta;
              onEvent({ type: 'text', text: delta });
            },
          });
        } catch (err) {
          // Degrade gracefully: some local models reject the tools parameter.
          // They still answer — they just can't act.
          if (useTools && i === 0 && /tool/i.test(err.message)) {
            useTools = false;
            continue;
          }
          throw err;
        }

        if (!completion.toolCalls.length) break;

        providerMessages.push({
          role: 'assistant',
          content: completion.text || null,
          tool_calls: completion.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        for (const tc of completion.toolCalls) {
          toolsUsed.push(tc.name);
          let input = {};
          try { input = JSON.parse(tc.arguments || '{}'); } catch { /* leave empty */ }
          onEvent({ type: 'tool_start', name: tc.name, input });
          let result, isError = false;
          try {
            result = await executeTool(tc.name, input);
          } catch (err) {
            result = `Error: ${err.message}`;
            isError = true;
          }
          onEvent({ type: 'tool_result', name: tc.name, ok: !isError });
          providerMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(result ?? 'ok') });
        }
        if (finalText) {
          finalText += '\n\n';
          onEvent({ type: 'text', text: '\n\n' });
        }
      }

      return { text: finalText, toolsUsed };
    },
  };
}

async function streamCompletion({ baseUrl, apiKey, model, messages, tools, onText }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true, ...(tools ? { tools } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${detail.slice(0, 400)}`);
  }

  let text = '';
  const toolCalls = []; // accumulated by index: { id, name, arguments }
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onText(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        toolCalls[idx] ??= { id: tc.id || `call_${idx}`, name: '', arguments: '' };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
      }
    }
  }
  return { text, toolCalls: toolCalls.filter(Boolean) };
}
