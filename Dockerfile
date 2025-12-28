FROM node:20-slim

# Install system dependencies required for native modules (sqlite3)
# python3, make, and g++ are often needed for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Create necessary directories for persistence if they don't exist in the image
RUN mkdir -p db public/uploads

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
