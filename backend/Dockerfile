FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# products.json is committed to the repo — no scraping needed at build time
# If missing, import-data will auto-run on first server start

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
