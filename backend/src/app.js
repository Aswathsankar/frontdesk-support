/**
 * Fastify application builder.
 * Registers all plugins and routes.
 * Exported as a factory so tests can build a fresh instance.
 */
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { getConnection } from './db/connection.js';
import { defineModels } from './db/models/index.js';
import { authRoutes } from './routes/auth.js';
import { agentTicketRoutes } from './routes/agentTickets.js';
import { publicTicketRoutes } from './routes/publicTickets.js';
import { holidayRoutes } from './routes/holidays.js';
import { autoCloseEligibleTickets } from './services/ticketService.js';
import cron from 'node-cron';
import { AUTO_CLOSE_CRON } from './config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: config.nodeEnv !== 'test',
    ...opts,
  });

  // ── DB ──────────────────────────────────────────────────────────
  const sequelize = await getConnection();
  const models = defineModels(sequelize);
  fastify.decorate('sequelize', sequelize);
  fastify.decorate('models', models);

  // ── Plugins ─────────────────────────────────────────────────────
  await fastify.register(fastifyCors, {
    origin: config.nodeEnv === 'development' ? true : false,
    credentials: true,
  });

  await fastify.register(fastifyCookie, {
    secret: config.jwtSecret,
  });

  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
  });

  // Rate limit for public routes
  await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Only rate-limit /api/public
    skipOnError: false,
    keyGenerator: (req) => req.ip,
    // Skip for agent routes
    skip: (req) => !req.url.startsWith('/api/public'),
  });

  // ── Auth decorator ───────────────────────────────────────────────
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify({ onlyCookie: true });
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ── Routes ───────────────────────────────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(agentTicketRoutes, { prefix: '/api/agent' });
  await fastify.register(publicTicketRoutes, { prefix: '/api/public' });
  await fastify.register(holidayRoutes, { prefix: '/api/agent' });

  // ── Health check ─────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // ── Serve React build ────────────────────────────────────────────
  const frontendDist = path.resolve(__dirname, config.frontendDist);
  try {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      decorateReply: false,
    });
    // SPA fallback
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html', frontendDist);
      }
    });
  } catch {
    // Frontend dist not built yet (dev mode)
    fastify.setNotFoundHandler((req, reply) => {
      reply.code(404).send({ error: 'Not found' });
    });
  }

  // ── Auto-close cron (every 5 min) ────────────────────────────────
  if (config.nodeEnv !== 'test') {
    cron.schedule(AUTO_CLOSE_CRON, async () => {
      try {
        const closed = await autoCloseEligibleTickets(sequelize);
        if (closed.length > 0) {
          fastify.log.info({ closed }, 'Auto-closed tickets');
        }
      } catch (err) {
        fastify.log.error(err, 'Auto-close cron error');
      }
    });
  }

  return fastify;
}
