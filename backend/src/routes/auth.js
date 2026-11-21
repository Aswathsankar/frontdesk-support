/**
 * Auth routes: login + logout.
 * Sets JWT in httpOnly, SameSite=Lax cookie.
 */
import bcrypt from 'bcryptjs';

export async function authRoutes(fastify) {
  // POST /api/auth/login
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body;
    const { sequelize } = fastify;

    const [[agent]] = await sequelize.query(
      'SELECT id, name, email, password_hash FROM agents WHERE email = ?',
      { replacements: [email] }
    );
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, agent.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      { id: agent.id, name: agent.name, email: agent.email },
      { expiresIn: '8h' }
    );

    reply
      .setCookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 8 * 60 * 60,
      })
      .send({ id: agent.id, name: agent.name, email: agent.email });
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (req, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ ok: true });
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    return { id: req.user.id, name: req.user.name, email: req.user.email };
  });
}
