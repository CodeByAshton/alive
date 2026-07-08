// Tiny MCP server (streamable HTTP) used by the e2e suite to prove the
// connector path end-to-end: initialize, tools/list (one echo tool),
// tools/call.

import http from 'node:http';

const PORT = Number(process.env.PORT || 8975);

http
  .createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'mock-session' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      switch (msg.method) {
        case 'initialize':
          reply({
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp', version: '0.1.0' },
          });
          break;
        case 'notifications/initialized':
          res.writeHead(202).end();
          break;
        case 'tools/list':
          reply({
            tools: [
              {
                name: 'echo',
                description: 'Echo back the given text.',
                inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
              },
            ],
          });
          break;
        case 'tools/call':
          reply({ content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text ?? ''}` }] });
          break;
        default:
          reply({});
      }
    });
  })
  .listen(PORT, () => console.log(`mock mcp on :${PORT}`));
