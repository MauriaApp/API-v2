import { FastifyInstance } from 'fastify';
import { SessionManager } from '../utils/session-manager';
import { IdRequest } from '../../../types/aurion';
import { AurionAbsences } from './absences';
import Sentry from '@sentry/node';

export async function absencesRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: IdRequest }>(
    '/aurion/absences',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
          },
          required: ['email', 'password'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    type: { type: 'string' },
                    duration: { type: 'string' },
                    time: { type: 'string' },
                    class: { type: 'string' },
                    teacher: { type: 'string' },
                  },
                },
              },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const sessionManager = new SessionManager();
      const aurionClient = new AurionAbsences(sessionManager);

      try {
        const absences = await aurionClient.getAllAbsences(
          request.body.email,
          request.body.password
        );
        return { success: true, data: absences };
      } catch (error) {
        Sentry.captureException(error);

        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
