import type { FastifyInstance } from 'fastify'

export function registerHealthRoute(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'agent-server' })
  })
}
