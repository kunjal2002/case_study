FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# Import 1,600+ real PartSelect products from CSV
RUN node src/data/import-csv.js

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
