FROM node:20-slim
WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json tsconfig.base.json ./

# Copy package manifests
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm ci --ignore-scripts

# Copy source
COPY packages/api ./packages/api
COPY packages/web ./packages/web

# Build web frontend
RUN npm -w packages/web run build

# Build API
RUN npm -w packages/api run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "packages/api/dist/server.js"]
