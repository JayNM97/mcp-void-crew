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

// 1. Wir definieren unsere neuen Such-Werkzeuge
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

// 2. Die Logik: Was passiert, wenn der Bot sucht?
async function searchWiki(baseUrl, query) {
  try {
    // A. Suche nach dem Begriff
    const searchRes = await fetch(`${baseUrl}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`);
    const searchData = await searchRes.json();

    if (!searchData.query.search || searchData.query.search.length === 0) {
      return `Keine Ergebnisse für "${query}" gefunden.`;
    }

    // B. Nimm den Titel des besten Treffers
    const bestMatchTitle = searchData.query.search[0].title;

    // C. Hole den reinen Text dieses Artikels (ohne HTML!)
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

// SSE Mantel für Copilot Studio (bleibt gleich)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Such-Server laeuft!`);
});
