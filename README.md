# Serper Search MCP Server

A Model Context Protocol (MCP) server that enables web searching using the Serper API for Google search results.

## Features

- Search the web using Serper API for Google search results
- Requires Serper API key for authentication
- Returns structured results with titles, URLs, and descriptions
- **Fetches and includes actual web page content for each result**
- Configurable number of results per search
- **Supports streamable-http transport for LibreChat integration**
- **Docker containerization support**
- **Health checks and monitoring**
- **Built-in rate limiting to respect API limits**

## Installation

1. Clone or download this repository
2. Install dependencies:
```bash
npm install
```
3. Build the server:
```bash
npm run build
```

## Usage Modes

### Local Development (Stdio Mode)

For local development and direct MCP client integration:

```bash
npm start
```

Add the server to your MCP configuration:

For VSCode (Claude Dev Extension):
```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/web-search/build/index.js"]
    }
  }
}
```

For Claude Desktop:
```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/web-search/build/index.js"]
    }
  }
}
```

### HTTP Mode (Container-Ready)

For containerized deployments or LibreChat integration:

```bash
# Start in HTTP mode
npm run start:http
# or
node build/index.js --http
# or set environment variable
MCP_HTTP_MODE=true npm start
```

The server will expose:
- **MCP endpoint**: `http://localhost:3000/mcp` (for JSON-RPC 2.0 requests)
- **Health endpoint**: `http://localhost:3000/health`
- **Health check**: `http://localhost:3000/health`

## Docker Deployment

### Using Docker directly:

```bash
# Build the image
npm run docker:build

# Run the container
npm run docker:run
```

Or manually:
```bash
docker build -t web-search-mcp .
docker run -p 3000:3000 -e MCP_HTTP_MODE=true web-search-mcp
```

### Using Docker Compose:

```bash
# Start the service
npm run docker:up

# View logs
npm run docker:logs

# Stop the service
npm run docker:down
```

### Container Configuration

Environment variables:
- `MCP_HTTP_MODE`: Set to `true` to enable HTTP/SSE mode
- `PORT`: Port number (default: 3000)
- `SEARCH_RATE_LIMIT_MS`: Minimum milliseconds between search requests (default: 500)

The container includes:
- Health checks
- Non-root user execution
- CORS support
- Automatic restart policies

## Rate Limiting

The server includes built-in rate limiting to be respectful to Google's servers:

- **Default**: Minimum 500ms between search requests
- **Configurable**: Set `SEARCH_RATE_LIMIT_MS` environment variable
- **Automatic**: If requests come in faster than the limit, the server will automatically wait
- **Logging**: Rate limiting events are logged to stderr

Example with custom rate limit:
```bash
# Set 1 second minimum between searches
SEARCH_RATE_LIMIT_MS=1000 npm run start:http
```

## API Reference

### Tool: `search`

Parameters:
```typescript
{
  "query": string,    // The search query
  "limit": number     // Optional: Number of results to return (default: 5, max: 10)
}
```

### HTTP/SSE API

#### Health Check
```
GET /health
```
Returns:
```json
{
  "status": "ok",
  "service": "web-search-mcp"
}
```

#### SSE Connection
```
GET /sse
```
Establishes Server-Sent Events connection for real-time communication.

#### Message Endpoint
```
POST /message
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": {
      "query": "your search query",
      "limit": 5
    }
  }
}
```

## Testing

A test client is included (`test-client.html`) for testing the HTTP/SSE endpoint. Open it in a browser and ensure the server is running in HTTP mode.

## Example Usage

### MCP Client (stdio mode):
```typescript
use_mcp_tool({
  server_name: "web-search",
  tool_name: "search",
  arguments: {
    query: "your search query",
    limit: 3
  }
})
```

### HTTP API (container mode):
```javascript
const response = await fetch('http://localhost:3000/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: {
      name: "search",
      arguments: { query: "Model Context Protocol", limit: 5 }
    }
  })
});
```

Example response:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"title\":\"Example Result\",\"url\":\"https://example.com\",\"description\":\"Description...\"}]"
      }
    ]
  }
}
```

## Limitations

Since this tool uses web scraping of Google search results, there are some important limitations to be aware of:

1. **Rate Limiting**: Google may temporarily block requests if too many searches are performed in a short time. To avoid this:
   - Keep searches to a reasonable frequency
   - Use the limit parameter judiciously
   - Consider implementing delays between searches if needed

2. **Result Accuracy**: 
   - The tool relies on Google's HTML structure, which may change
   - Some results might be missing descriptions or other metadata
   - Complex search operators may not work as expected

3. **Legal Considerations**:
   - This tool is intended for personal use
   - Respect Google's terms of service
   - Consider implementing appropriate rate limiting for your use case

## Contributing

Feel free to submit issues and enhancement requests!
