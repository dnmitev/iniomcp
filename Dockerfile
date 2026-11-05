# syntax=docker/dockerfile:1

FROM node:26.13-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:26.13-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY LICENSE NOTICE ./
USER node
# stdio by default: the client keeps stdin open (docker run -i).
# HTTP: -e MCP_TRANSPORT=http -e MCP_AUTH_TOKEN -p 127.0.0.1:3000:3000. HOST=0.0.0.0 makes the
# port reachable from outside the container; requests still need the bearer token.
ENV HOST=0.0.0.0
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]
