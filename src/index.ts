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
  content: string;
  contentError?: string;
}

const isValidSearchArgs = (args: any): args is { query: string; limit?: number; maxContentLength?: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.query === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.maxContentLength === undefined || typeof args.maxContentLength === 'number');

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
        description: 'Search the web using Serper API and fetch full content from each result page',
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
            maxContentLength: {
              type: 'number',
              description: 'Maximum length of content to extract from each page (default: 50000 characters)',
              minimum: 1000,
              maximum: 200000,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch_page_content',
        description: 'Fetch and clean the main content of a web page, with a configurable content length limit',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the web page to fetch',
            },
            maxContentLength: {
              type: 'number',
              description: 'Maximum length of content to extract (default: 50000 characters)',
              minimum: 1000,
              maximum: 200000,
            },
          },
          required: ['url'],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'search') {
      if (!isValidSearchArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid search arguments'
        );
      }
      const query = request.params.arguments.query;
      const limit = Math.min(request.params.arguments.limit || 5, 10);
      const maxContentLength = request.params.arguments.maxContentLength;
      try {
        const results = await performSearch(query, limit, maxContentLength);
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
    } else if (request.params.name === 'fetch_page_content') {
      const args = request.params.arguments;
      if (!args || typeof args.url !== 'string' || (args.maxContentLength !== undefined && typeof args.maxContentLength !== 'number')) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid arguments for fetch_page_content'
        );
      }
      try {
        const { content, error } = await fetchPageContent(args.url, args.maxContentLength);
        return {
          content: [
            {
              type: 'text',
              text: error ? `${content}\n\n[Error: ${error}]` : content,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    } else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }
  });

  server.onerror = (error) => console.error('[MCP Error]', error);
  
  return server;
}

// Function to fetch and clean web page content
async function fetchPageContent(url: string, maxContentLength?: number): Promise<{ content: string; error?: string }> {
  try {
    console.error(`Fetching content from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 15000, // 15 second timeout
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    });

    // Basic HTML content extraction and cleaning
    let content = response.data;
    
    if (typeof content === 'string') {
      // Remove script and style tags
      content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
      
      // Remove comments
      content = content.replace(/<!--[\s\S]*?-->/g, '');
      
      // Remove HTML tags but keep the text content
      content = content.replace(/<[^>]*>/g, ' ');
      
      // Decode HTML entities
      content = content.replace(/&nbsp;/g, ' ')
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'");
      
      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();
      
      // Configurable content length limit - much more generous for comprehensive content
      const maxLength = maxContentLength || parseInt(process.env.MAX_CONTENT_LENGTH || '50000'); // Default 50KB
      if (content.length > maxLength) {
        // Try to truncate at a sentence boundary for better readability
        const truncated = content.substring(0, maxLength);
        const lastSentence = truncated.lastIndexOf('. ');
        const lastParagraph = truncated.lastIndexOf('\n');
        const cutPoint = Math.max(lastSentence, lastParagraph);
        
        if (cutPoint > maxLength * 0.8) { // If we can cut at a good point
          content = truncated.substring(0, cutPoint + 1) + '\n\n... [Content truncated - see full article at URL]';
        } else {
          content = truncated + '... [Content truncated - see full article at URL]';
        }
      }
      
      console.error(`Successfully fetched ${content.length} characters from ${url}`);
      return { content };
    } else {
      return { content: '[Non-text content]', error: 'Content is not text-based' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to fetch content from ${url}: ${errorMessage}`);
    return { 
      content: '[Content unavailable]', 
      error: `Failed to fetch content: ${errorMessage}` 
    };
  }
}

// Search function
async function performSearch(query: string, limit: number, maxContentLength?: number): Promise<SearchResult[]> {
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
    // Fetch content for each result in parallel
    const contentPromises = response.data.organic.slice(0, limit).map(async (result: any) => {
      const url = result.link || '';
      const { content, error } = await fetchPageContent(url, maxContentLength);
      
      return {
        title: result.title || 'No title',
        url,
        description: result.snippet || 'No description available',
        content,
        ...(error && { contentError: error }),
      };
    });

    // Wait for all content fetching to complete
    const searchResults = await Promise.all(contentPromises);
    results.push(...searchResults);
  }

  console.error(`Found ${results.length} results with content`);
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
            description: 'Search the web using Serper API and fetch full content from each result page',
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
                maxContentLength: {
                  type: 'number',
                  description: 'Maximum length of content to extract from each page (default: 50000 characters)',
                  minimum: 1000,
                  maximum: 200000,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'fetch_page_content',
            description: 'Fetch and clean the main content of a web page, with a configurable content length limit',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL of the web page to fetch',
                },
                maxContentLength: {
                  type: 'number',
                  description: 'Maximum length of content to extract (default: 50000 characters)',
                  minimum: 1000,
                  maximum: 200000,
                },
              },
              required: ['url'],
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
          const maxContentLength = args.maxContentLength;
          try {
            const results = await performSearch(query, limit, maxContentLength);
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
        } else if (toolName === 'fetch_page_content') {
          if (!args || typeof args.url !== 'string' || (args.maxContentLength !== undefined && typeof args.maxContentLength !== 'number')) {
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
          try {
            const { content, error } = await fetchPageContent(args.url, args.maxContentLength);
            res.json({
              jsonrpc: '2.0',
              result: {
                content: [
                  {
                    type: 'text',
                    text: error ? `${content}\n\n[Error: ${error}]` : content,
                  },
                ],
              },
              id: request.id
            });
          } catch (error) {
            res.json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
