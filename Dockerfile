# Imaginea API-ului. Frontend-ul e static și se publică separat.
#
# Two stages: the first has the whole workspace and every dev dependency,
# because building `@samobi/api` needs TypeScript and the compiled
# `@samobi/shared`; the second keeps only what runs.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# The manifests first, so a change to source code does not re-download the
# dependency tree on every deploy.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json* ./
# Order matters: the API compiles against the shared package's declarations.
RUN pnpm --filter @samobi/shared build && pnpm --filter @samobi/api build

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @samobi/api...

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist

# `@samobi/shared` resolves to dist here and to src under tsx, through the
# `development` condition in its exports map. Node does not set that condition,
# which is exactly what makes this work.
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
