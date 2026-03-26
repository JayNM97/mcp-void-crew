import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

const server = new Server(
  { name: 'void-crew-search-server', version: '4.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_official_wiki',
      description: 'Durchsucht das offizielle Void Crew Wiki (wiki.gg) nach einem Begriff und liefert den Text des besten Artikels.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Der Suchbegriff' } },
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

// --- WIR GEBEN NACH: ALLES LÄUFT ÜBER /mcp ---
const sessions = new Map();

// 1. Copilot baut die Verbindung auf (GET)
app.get('/mcp', async (req, res) => {
  // Wir sagen ihm: "Schick deine Antworten an /mcp"
  const transport = new SSEServerTransport('/mcp', res);
  await server.connect(transport);
  
  sessions.set(transport.sessionId, transport);

  req.on('close', () => {
    sessions.delete(transport.sessionId);
  });
});

// 2. Copilot schickt stur seine Befehle (POST) an dieselbe Adresse
app.post('/mcp', async (req, res) => {
  const sessionId = req.query.sessionId;
  
  // Wenn Copilot die Session-ID "vergisst", schnappen wir uns einfach die letzte aktive Verbindung
  const transport = sessionId ? sessions.get(sessionId) : Array.from(sessions.values()).pop();

  if (!transport) {
    return res.status(404).send("Keine aktive Session gefunden.");
  }

  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server laeuft - und ist jetzt kugelsicher gegen Copilot Studio!`);
});
