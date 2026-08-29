FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
# Full install (incl. devDependencies) regardless of NODE_ENV — the build
# stage needs typescript, which `npm ci --omit=dev` would strip.
RUN npm ci

COPY . .

RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Railway (and most PaaS hosts) inject PORT at runtime; src/env.ts reads it
# with a default of 8787 for local/non-Railway use.
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "dist/src/index.js"]
