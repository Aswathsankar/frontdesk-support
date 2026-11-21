/**
 * Holiday routes — agent-only (requires auth).
 * GET /api/agent/holidays
 * POST /api/agent/holidays
 * DELETE /api/agent/holidays/:date
 */
export async function holidayRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/holidays', async (req, reply) => {
    const [holidays] = await fastify.sequelize.query(
      'SELECT id, date, name FROM holidays ORDER BY date ASC'
    );
    return { holidays };
  });

  fastify.post('/holidays', {
    schema: {
      body: {
        type: 'object',
        required: ['date', 'name'],
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const { date, name } = req.body;
    try {
      await fastify.sequelize.query(
        'INSERT INTO holidays (date, name) VALUES (?, ?)',
        { replacements: [date, name] }
      );
      return reply.code(201).send({ ok: true });
    } catch (err) {
      if (err.original?.code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({ error: 'Holiday already exists for that date' });
      }
      throw err;
    }
  });

  fastify.delete('/holidays/:date', async (req, reply) => {
    const { date } = req.params;
    await fastify.sequelize.query(
      'DELETE FROM holidays WHERE date = ?',
      { replacements: [date] }
    );
    return { ok: true };
  });
}
