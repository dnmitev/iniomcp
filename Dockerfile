# syntax=docker/dockerfile:1

FROM node:26.12-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:26.12-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
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
