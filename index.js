import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json()); // Wichtig, damit der Server Text versteht

// Wir taufen unseren Server
const server = new Server(
  { name: 'void-crew-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Wir definieren das Fetch-Tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'fetch_website',
    description: 'Liest den Text einer Webseite aus (z.B. fuer Wiki-Eintraege)',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url']
    }
  }]
}));

// Wir sagen dem Tool, was es tun soll, wenn es aufgerufen wird
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'fetch_website') {
    const response = await fetch(request.params.arguments.url);
    const text = await response.text();
    // Wir senden die ersten 10.000 Zeichen zurück, das reicht für die KI
    return { content: [{ type: 'text', text: text.substring(0, 10000) }] };
  }
  throw new Error('Tool nicht gefunden');
});

// Hier ist der magische "SSE-Mantel" für Copilot Studio
let transport;
app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/message', res);
  await server.connect(transport);
});

app.post('/message', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

// Den Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server laeuft und wartet auf Copilot Studio!`);
});
