# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files first to cache dependencies
COPY package*.json ./

# Clean install of production dependencies only
RUN npm ci --only=production

# Copy application files
COPY . .

# Runtime stage
FROM node:20-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy application and node_modules from builder
COPY --from=builder /app ./

# Create directories for persistence with correct permissions
RUN mkdir -p db public/uploads && chown -R node:node /app

# Use non-root user for security
USER node

# Healthcheck - aumentado start-period para 30s (SQLite precisa de tempo para inicializar)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/login || exit 1

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server.js"]
