# Vault server container: builds the web client, then ships a slim runtime
# that serves the client + API + WS from one process on :8787.
#
#   docker build -t vault .
#   docker run -p 8787:8787 \
#     -e VAULT_KEY=... \
#     -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... \
#     -e ANTHROPIC_API_KEY=... \
#     vault
#
# Without Supabase env, state lives in /data (mount a volume to keep it).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
ENV VAULT_DATA=/data/vault.json
VOLUME /data
EXPOSE 8787
CMD ["node", "server/index.mjs"]
