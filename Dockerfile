FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Expose port (harus match dengan PORT env variable)
EXPOSE 3000

# Health check bawaan Docker — Dokploy akan pakai ini
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
