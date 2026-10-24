# Build context is the repository root:
#   docker build -f taxis/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ARG BUILD_VERSION=dev
ARG BUILD_ARCH=amd64
LABEL io.hass.type="addon" \
      io.hass.name="Taxis" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/davidcas77/ha-taxis"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8099 \
    TAXIS_VERSION=${BUILD_VERSION}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8099
CMD ["node", "dist/server.js"]
