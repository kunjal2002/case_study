FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

RUN node src/data/seed-db.js

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
