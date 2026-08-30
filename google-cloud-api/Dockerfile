FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
