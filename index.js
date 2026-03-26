import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

const server = new Server(
  { name: 'void-crew-search-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_official_wiki',
      description: 'Durchsucht das offizielle Void Crew Wiki (wiki.gg) nach einem Begriff und liefert den Text des besten Artikels.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Der Suchbegriff, z.B. "Engineer" oder "Bugs"' } },
        required: ['query']
      }
    },
    {
      name: 'search_fandom_wiki',
      description: 'Durchsucht das Void Crew Fandom Wiki nach einem Begriff und liefert den Text des besten Artikels.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Der Suchbegriff' } },
        required: ['query']
      }
    }
  ]
}));

async function searchWiki(baseUrl, query) {
  try {
    const searchRes = await fetch(`${baseUrl}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`);
    const searchData = await searchRes.json();

    if (!searchData.query.search || searchData.query.search.length === 0) {
      return `Keine Ergebnisse für "${query}" gefunden.`;
    }

    const bestMatchTitle = searchData.query.search[0].title;
    const articleRes = await fetch(`${baseUrl}/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(bestMatchTitle)}&format=json`);
    const articleData = await articleRes.json();

    const pages = articleData.query.pages;
    const pageId = Object.keys(pages)[0];
    const text = pages[pageId].extract;

    return `Gefundener Artikel: ${bestMatchTitle}\n\n${text.substring(0, 10000)}`;
  } catch (error) {
    return `Fehler bei der Wiki-Abfrage: ${error.message}`;
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'search_official_wiki') {
    const result = await searchWiki('https://voidcrew.wiki.gg', request.params.arguments.query);
    return { content: [{ type: 'text', text: result }] };
  }
  if (request.params.name === 'search_fandom_wiki') {
    const result = await searchWiki('https://void-crew.fandom.com', request.params.arguments.query);
    return { content: [{ type: 'text', text: result }] };
  }
  throw new Error('Tool nicht gefunden');
});

// --- BULLETPROOF MCP CONNECTION MANAGER ---
const activeSessions = new Map();

// 1. Copilot baut die Verbindung auf
app.get('/sse', async (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  
  // Wir sagen Copilot, er soll mit Session-ID an /message antworten
  const transport = new SSEServerTransport(`/message?sessionId=${sessionId}`, res);
  activeSessions.set(sessionId, transport);

  // Wenn Copilot die Verbindung schließt, räumen wir auf
  req.on('close', () => {
    activeSessions.delete(sessionId);
  });

  await server.connect(transport);
});

// 2. Copilot schickt einen Werkzeug-Befehl (Wir fangen alles ab!)
const handlePost = async (req, res) => {
  const sessionId = req.query.sessionId;
  
  // Wenn Copilot die ID mitschickt, nehmen wir diese. 
  // Wenn MS wieder stur ist und keine ID schickt, nehmen wir einfach die zuletzt aktive Session!
  const transport = sessionId ? activeSessions.get(sessionId) : Array.from(activeSessions.values()).pop();

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    // 503 signalisiert Copilot Studio: "Verbindung war weg, bitte erst neu aufbauen (GET)!"
    res.status(503).send("Verbindung unterbrochen. Bitte neu verbinden.");
  }
};

// Wir lauschen auf beide Türen, egal welche Copilot nutzt
app.post('/message', handlePost);
app.post('/sse', handlePost);
// ---------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Such-Server laeuft!`);
});
