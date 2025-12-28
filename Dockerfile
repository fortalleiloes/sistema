# Build stage
FROM node:20 AS builder

WORKDIR /app

# Copy package files first to cache dependencies
COPY package*.json ./

# Clean install of dependencies (including dev deps if needed for build, but usually production is better)
# Using npm ci --omit=dev to keep it clean, unless you have build scripts that need dev deps
RUN npm ci

# Copy output files
COPY . .

# Runtime stage - using full node image to ensure all runtime dependencies (curl, libs) are present
FROM node:20

WORKDIR /app

# Install curl for healthcheck if not present (node:20 usually has it, but good to be sure)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy application and node_modules from builder
COPY --from=builder /app ./

# Create directories for persistence
RUN mkdir -p db public/uploads && chown -R node:node /app

# Define volumes for EasyPanel auto-discovery of persistence needs
VOLUME ["/app/db", "/app/public/uploads"]

# Use non-root user for security
USER node

# Healthcheck to ensure container is running correctly
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/login || exit 1

EXPOSE 3000

CMD ["node", "server.js"]
