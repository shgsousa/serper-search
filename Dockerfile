# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies (exclude prepare script to avoid building)
RUN npm ci --only=production --ignore-scripts

# Copy built application
COPY build/ ./build/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001

# Change ownership of the app directory
RUN chown -R mcp:nodejs /app
USER mcp

# Expose port (default 3000, configurable via PORT env var)
EXPOSE 3000

# Note: All environment variables should be provided at runtime:
# - SERPER_API_KEY (required): Your Serper API key
# - MCP_HTTP_MODE (optional): Enable HTTP mode (default: true for Docker)
# - PORT (optional): Server port (default: 3000)
# - SEARCH_RATE_LIMIT_MS (optional): Rate limiting in ms (default: 500)

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "build/index.js"]
