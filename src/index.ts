#!/usr/bin/env node
import express from 'express';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

const isValidSearchArgs = (args: any): args is { query: string; limit?: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.query === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number');

// Create MCP server
function createMCPServer() {
  const server = new Server(
    {
      name: 'serper-search',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register the search tool
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search',
        description: 'Search the web using Serper API',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 5)',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'search') {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }

    if (!isValidSearchArgs(request.params.arguments)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid search arguments'
      );
    }

    const query = request.params.arguments.query;
    const limit = Math.min(request.params.arguments.limit || 5, 10);

    try {
      const results = await performSearch(query, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          content: [
            {
              type: 'text',
              text: `Search error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  });

  server.onerror = (error) => console.error('[MCP Error]', error);
  
  return server;
}

// Search function
async function performSearch(query: string, limit: number): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is required');
  }

  console.error(`Performing search for: "${query}" (limit: ${limit})`);

  const response = await axios.post('https://google.serper.dev/search', 
    {
      q: query,
      num: limit,
    },
    {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  const results: SearchResult[] = [];
  if (response.data.organic) {
    for (const result of response.data.organic.slice(0, limit)) {
      results.push({
        title: result.title || 'No title',
        url: result.link || '',
        description: result.snippet || 'No description available',
      });
    }
  }

  console.error(`Found ${results.length} results`);
  return results;
}

// HTTP server for streamable-http transport
function createHTTPServer() {
  const app = express();
  app.use(express.json());

  // Map to store servers by session ID
  const servers: { [sessionId: string]: Server } = {};

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Handle POST requests for client-to-server communication
  app.post('/mcp', async (req, res) => {
    try {
      console.error('Received MCP request:', req.body);
      
      const request = req.body;
      
      if (request.method === 'initialize') {
        // Handle MCP initialization
        res.json({
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'serper-search',
              version: '0.1.0',
            },
          },
          id: request.id
        });
        
      } else if (request.method === 'tools/list') {
        // Return tools list directly
        const tools = [
          {
            name: 'search',
            description: 'Search the web using Serper API',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 5)',
                  minimum: 1,
                  maximum: 10,
                },
              },
              required: ['query'],
            },
          },
        ];
        
        res.json({
          jsonrpc: '2.0',
          result: { tools },
          id: request.id
        });
        
      } else if (request.method === 'tools/call') {
        // Handle tool call
        const toolName = request.params.name;
        const args = request.params.arguments;
        
        if (toolName === 'search') {
          if (!isValidSearchArgs(args)) {
            res.json({
              jsonrpc: '2.0',
              error: {
                code: -32602,
                message: 'Invalid parameters',
              },
              id: request.id,
            });
            return;
          }
          
          const query = args.query;
          const limit = Math.min(args.limit || 5, 10);
          
          try {
            const results = await performSearch(query, limit);
            res.json({
              jsonrpc: '2.0',
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(results, null, 2),
                  },
                ],
              },
              id: request.id
            });
          } catch (error) {
            console.error('Search error:', error);
            res.json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
              id: request.id,
            });
          }
        } else {
          res.json({
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: `Unknown tool: ${toolName}`,
            },
            id: request.id,
          });
        }
        
      } else {
        res.json({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
          id: request.id || null,
        });
      }
    } catch (error) {
      console.error('Error handling MCP request:', error);
      res.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
        },
        id: req.body.id || null,
      });
    }
  });

  // Handle GET requests for server-to-client notifications via SSE
  app.get('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !servers[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    
    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send heartbeat
    const heartbeat = setInterval(() => {
      res.write(`data: {"type": "heartbeat", "timestamp": ${Date.now()}}\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  // Handle DELETE requests for session termination
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && servers[sessionId]) {
      delete servers[sessionId];
      console.error(`Deleted session: ${sessionId}`);
    }
    res.status(200).send('Session terminated');
  });

  return app;
}

// Main function
async function main() {
  const httpMode = process.env.MCP_HTTP_MODE === 'true';
  
  if (httpMode) {
    // HTTP mode with Express
    const app = createHTTPServer();
    const port = parseInt(process.env.PORT || '3000');
    
    app.listen(port, () => {
      console.error(`Serper Search MCP Server running on port ${port} in HTTP mode`);
    });
    
  } else {
    // stdio mode
    const server = createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Serper Search MCP Server running in stdio mode');
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.error('Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });
}

main().catch(console.error);
