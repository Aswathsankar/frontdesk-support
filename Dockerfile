# Multi-stage Dockerfile
# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --omit=dev
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend + built frontend
FROM node:20-alpine AS runner
WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy built frontend into where @fastify/static will serve it
COPY --from=frontend-builder /app/frontend/dist ./public

# Set frontend dist path for the app
ENV FRONTEND_DIST=./public
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "node src/db/runner.js && node src/server.js"]
