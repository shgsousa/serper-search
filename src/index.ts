#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import http from 'http';

interface SearchResult {
  title: string;
  url: string;
  description: string;
  content?: string;
  finalUrl?: string; // The final URL after following redirects
}

const isValidSearchArgs = (args: any): args is { query: string; limit?: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.query === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number');

class WebSearchServer {
  private server: Server;
  private lastSearchTime: number = 0;
  private readonly minSearchInterval: number = parseInt(process.env.SEARCH_RATE_LIMIT_MS || '500'); // configurable rate limit

  constructor() {
    this.server = new Server(
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

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      console.error('Received SIGINT, shutting down gracefully...');
      await this.server.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.error('Received SIGTERM, shutting down gracefully...');
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.setupToolHandlersForServer(this.server);
  }

  private setupToolHandlersForServer(server: Server) {
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
        const results = await this.performSearch(query, limit);
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
  }

  private async fetchPageContent(url: string): Promise<{ content: string; finalUrl: string }> {
    return this.fetchPageContentWithLimit(url, 3); // Allow up to 3 redirections
  }

  private async fetchPageContentWithLimit(url: string, recursionLimit: number, visitedUrls: Set<string> = new Set()): Promise<{ content: string; finalUrl: string }> {
    if (recursionLimit <= 0) {
      console.error(`Recursion limit reached for URL: ${url}`);
      return { content: '[Redirection limit exceeded]', finalUrl: url };
    }
    
    // Check if we've already visited this URL to prevent infinite loops
    if (visitedUrls.has(url)) {
      console.error(`Circular redirection detected for URL: ${url}`);
      return { content: '[Circular redirection detected]', finalUrl: url };
    }
    
    visitedUrls.add(url);
    
    try {
      console.error(`Fetching content for: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive'
        },
        timeout: 8000, // Shorter timeout for content fetching
        maxContentLength: 1024 * 1024, // Limit to 1MB
        maxBodyLength: 1024 * 1024,
        maxRedirects: 10, // Follow up to 10 redirects
        validateStatus: function (status) {
          return status >= 200 && status < 400; // Accept redirects and success codes
        }
      });

      const finalUrl = response.request.res?.responseUrl || response.config.url || url;
      
      // Check if we've been redirected to a redirection page (common patterns)
      const isRedirectionPage = this.detectRedirectionPage(response.data, finalUrl);
      
      if (isRedirectionPage) {
        console.error(`Detected redirection page at ${finalUrl}, attempting to extract real URL`);
        const realUrl = this.extractRealUrlFromRedirectionPage(response.data, finalUrl);
        if (realUrl && realUrl !== finalUrl && !visitedUrls.has(realUrl)) {
          console.error(`Found real URL: ${realUrl}, fetching actual content`);
          // Recursively fetch the real URL with updated visited URLs set
          return this.fetchPageContentWithLimit(realUrl, recursionLimit - 1, visitedUrls);
        } else if (realUrl && realUrl === finalUrl) {
          console.error(`Real URL is same as current URL, treating as final content`);
        } else if (realUrl && visitedUrls.has(realUrl)) {
          console.error(`Real URL already visited, preventing circular redirection`);
        } else {
          console.error(`Could not extract a valid real URL from redirection page`);
        }
      }

      const $ = cheerio.load(response.data);
      
      // Remove script, style, and other non-content elements
      $('script, style, nav, header, footer, aside, .ad, .advertisement, .sidebar').remove();
      
      // Extract main content, prioritizing common content containers
      let content = '';
      const contentSelectors = [
        'main',
        'article',
        '.content',
        '.main-content',
        '#content',
        '#main',
        '.post-content',
        '.entry-content',
        'body'
      ];
      
      for (const selector of contentSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          content = element.text().trim();
          break;
        }
      }
      
      // Fallback to body text if no specific content area found
      if (!content) {
        content = $('body').text().trim();
      }
      
      // Clean up the content - remove excessive whitespace and limit length
      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
      
      // Limit content length to prevent overly large responses
      if (content.length > 15000) {
        content = content.substring(0, 15000) + '... [content truncated]';
      }
      
      console.error(`Content fetched for ${finalUrl}: ${content.length} characters`);
      return { content, finalUrl };
      
    } catch (error) {
      console.error(`Failed to fetch content for ${url}:`, error instanceof Error ? error.message : error);
      return { content: '[Content could not be fetched]', finalUrl: url };
    }
  }

  private detectRedirectionPage(html: string, url: string): boolean {
    // First check for explicit meta refresh or JavaScript redirects (most reliable)
    const hasMetaRefresh = /<meta[^>]+http-equiv=["']refresh["'][^>]*>/i.test(html);
    const hasJsRedirect = /window\.location\s*=|location\.href\s*=|location\.replace\s*\(/i.test(html);
    
    if (hasMetaRefresh || hasJsRedirect) {
      return true;
    }
    
    // Check for very specific redirection page patterns
    const strongRedirectionIndicators = [
      /please click here if the page does not redirect automatically/i,
      /you are being redirected to/i,
      /automatic redirect/i,
      /if you are not redirected.*click/i
    ];
    
    const hasStrongIndicator = strongRedirectionIndicators.some(pattern => pattern.test(html));
    
    if (hasStrongIndicator) {
      // Additional check: ensure the page content is actually minimal (typical of redirect pages)
      const textContent = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const isSuspiciouslyShort = textContent.length < 300;
      
      return isSuspiciouslyShort;
    }
    
    // Be more conservative - only detect obvious redirect pages
    return false;
  }

  private extractRealUrlFromRedirectionPage(html: string, currentUrl: string): string | null {
    try {
      // Try to extract URL from meta refresh tag
      const metaRefreshMatch = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;"]*;\s*url=([^"']+)["']/i);
      if (metaRefreshMatch) {
        return this.resolveUrl(metaRefreshMatch[1], currentUrl);
      }
      
      // Try to extract URL from JavaScript redirects
      const jsRedirectMatches = [
        /window\.location\s*=\s*["']([^"']+)["']/i,
        /location\.href\s*=\s*["']([^"']+)["']/i,
        /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i
      ];
      
      for (const pattern of jsRedirectMatches) {
        const match = html.match(pattern);
        if (match) {
          return this.resolveUrl(match[1], currentUrl);
        }
      }
      
      // Try to extract URL from common link patterns in redirection pages
      const linkPatterns = [
        /<a[^>]+href=["']([^"']+)["'][^>]*>.*?click here.*?<\/a>/i,
        /<a[^>]+href=["']([^"']+)["'][^>]*>.*?continue.*?<\/a>/i,
        /<a[^>]+href=["']([^"']+)["'][^>]*>.*?proceed.*?<\/a>/i
      ];
      
      for (const pattern of linkPatterns) {
        const match = html.match(pattern);
        if (match) {
          const extractedUrl = match[1];
          // Only return if it's not the same URL and looks like a real URL
          if (extractedUrl !== currentUrl && extractedUrl.startsWith('http')) {
            return extractedUrl;
          }
        }
      }
      
      // Try to extract from query parameters (common with Bing redirects)
      if (currentUrl.includes('/ck/a?')) {
        const urlObj = new URL(currentUrl);
        const uParam = urlObj.searchParams.get('u');
        if (uParam) {
          // Bing encodes URLs in base64 sometimes
          try {
            const decodedUrl = atob(uParam);
            if (decodedUrl.startsWith('http')) {
              return decodedUrl;
            }
          } catch (e) {
            // Not base64, might be URL encoded
            const decodedUrl = decodeURIComponent(uParam);
            if (decodedUrl.startsWith('http')) {
              return decodedUrl;
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting real URL:', error);
      return null;
    }
  }

  private resolveUrl(url: string, baseUrl: string): string {
    try {
      // If it's already an absolute URL, return as is
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      
      // If it's a protocol-relative URL
      if (url.startsWith('//')) {
        const baseUrlObj = new URL(baseUrl);
        return baseUrlObj.protocol + url;
      }
      
      // If it's a relative URL, resolve it against the base URL
      const baseUrlObj = new URL(baseUrl);
      return new URL(url, baseUrlObj).href;
    } catch (error) {
      console.error('Error resolving URL:', error);
      return url;
    }
  }

  private async performSearch(query: string, limit: number): Promise<SearchResult[]> {
    // Rate limiting: ensure at least 500ms between searches
    const now = Date.now();
    const timeSinceLastSearch = now - this.lastSearchTime;
    
    if (timeSinceLastSearch < this.minSearchInterval) {
      const sleepTime = this.minSearchInterval - timeSinceLastSearch;
      console.error(`Rate limiting: sleeping for ${sleepTime}ms`);
      await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
    
    this.lastSearchTime = Date.now();

    console.error(`Searching for: "${query}"`);

    // Check if API key is provided
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      console.error('SERPER_API_KEY environment variable is not set');
      return [{
        title: 'Search configuration error',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
        description: 'Serper API key is not configured. Please set the SERPER_API_KEY environment variable.',
        content: 'Search API is not properly configured. The SERPER_API_KEY environment variable must be set to use the search functionality.'
      }];
    }

    try {
      const response = await axios.post('https://google.serper.dev/search', {
        q: query,
        num: limit
      }, {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.error(`Serper response status: ${response.status}`);
      console.error(`Serper response data:`, response.data);
      
      const results: SearchResult[] = [];
      
      if (response.data && response.data.organic) {
        const organicResults = response.data.organic.slice(0, limit);
        
        for (const result of organicResults) {
          if (result.link && result.title) {
            results.push({
              title: result.title,
              url: result.link,
              description: result.snippet || '',
              content: '' // Will be filled later
            });
          }
        }
      }

      console.error(`Results extracted: ${results.length}`);
      
      // Fetch content for each result
      if (results.length > 0) {
        console.error('Fetching content for search results...');
        await Promise.all(results.map(async (result, index) => {
          try {
            const contentData = await this.fetchPageContent(result.url);
            result.content = contentData.content;
            result.finalUrl = contentData.finalUrl;
            // Update URL if redirect was followed
            if (contentData.finalUrl !== result.url) {
              console.error(`Result ${index} redirected from ${result.url} to ${contentData.finalUrl}`);
            }
          } catch (error) {
            console.error(`Failed to fetch content for result ${index}:`, error);
            result.content = '[Content fetch failed]';
          }
        }));
      }
      
      return results;
      
    } catch (error) {
      console.error('Error during Serper search:', error);
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
      }
      
      // Return a helpful message if search fails
      return [{
        title: 'Search failed',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
        description: 'Search API request failed. Please try again later or search manually using the provided link.',
        content: 'Search API is temporarily unavailable. You can perform a manual search using the provided Google search link.'
      }];
    }
  }

  async run() {
    // Check for command line arguments to determine transport mode
    const args = process.argv.slice(2);
    const httpMode = args.includes('--http') || process.env.MCP_HTTP_MODE === 'true';
    const port = parseInt(process.env.PORT || '3000');
    
    if (httpMode) {
      // HTTP/SSE mode for containers
      const httpServer = http.createServer(async (req, res) => {
        // Enable CORS for cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        // Handle direct search API endpoint
        if (req.url === '/search' && req.method === 'POST') {
          try {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const data = JSON.parse(body);
                const query = data.query;
                const limit = Math.min(data.limit || 5, 10);
                
                if (!query || typeof query !== 'string') {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Query parameter is required' }));
                  return;
                }
                
                const results = await this.performSearch(query, limit);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ results }));
                
              } catch (error) {
                console.error('Search error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Search failed' }));
              }
            });
          } catch (error) {
            console.error('Request processing error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request processing failed' }));
          }
          return;
        }
        
        // Handle MCP protocol over HTTP
        if (req.url === '/message' && req.method === 'POST') {
          try {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const jsonrpcRequest = JSON.parse(body);
                
                if (jsonrpcRequest.method === 'tools/call' && jsonrpcRequest.params?.name === 'search') {
                  const args = jsonrpcRequest.params.arguments;
                  const query = args.query;
                  const limit = Math.min(args.limit || 5, 10);
                  
                  const results = await this.performSearch(query, limit);
                  const response = {
                    jsonrpc: '2.0',
                    id: jsonrpcRequest.id,
                    result: {
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify(results, null, 2)
                        }
                      ]
                    }
                  };
                  
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(response));
                } else if (jsonrpcRequest.method === 'tools/list') {
                  const response = {
                    jsonrpc: '2.0',
                    id: jsonrpcRequest.id,
                    result: {
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
                    }
                  };
                  
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(response));
                } else {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: jsonrpcRequest.id,
                    error: { code: -32601, message: 'Method not found' }
                  }));
                }
                
              } catch (error) {
                console.error('MCP request processing error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: { code: -32603, message: 'Internal error' }
                }));
              }
            });
          } catch (error) {
            console.error('Request processing error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: 'Internal error' }
            }));
          }
          return;
        }
        
        // Handle SSE connection requests (for future use)
        if (req.url === '/sse' && req.method === 'GET') {
          // Create SSE transport for this connection
          const transport = new SSEServerTransport('/message', res);
          
          try {
            // Create a new server instance for this connection
            const connectionServer = new Server(
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
            
            // Set up handlers for this connection
            this.setupToolHandlersForServer(connectionServer);
            
            // Connect the server to this transport
            await connectionServer.connect(transport);
            console.error('New SSE connection established');
            
          } catch (error) {
            console.error('Failed to connect transport:', error);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Internal Server Error');
            }
          }
          
          return;
        }
        
        // Handle health check
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service: 'serper-search' }));
          return;
        }
        
        // Default response for unknown endpoints
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });
      
      httpServer.listen(port, () => {
        console.error(`Web Search MCP server running on http://0.0.0.0:${port}`);
        console.error(`SSE endpoint: http://0.0.0.0:${port}/sse`);
        console.error(`Health check: http://0.0.0.0:${port}/health`);
        console.error('Use --http flag or set MCP_HTTP_MODE=true environment variable for HTTP mode');
      });
    } else {
      // Stdio mode for local development
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Web Search MCP server running in stdio mode');
    }
  }
}

const server = new WebSearchServer();
server.run().catch(console.error);
