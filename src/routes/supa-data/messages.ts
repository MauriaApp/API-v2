import { FastifyInstance } from 'fastify';
import { supabase } from './utils/supabase';

export async function messagesRoute(fastify: FastifyInstance) {
  fastify.get(
    '/messages',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['title', 'message'],
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const messages = await getMessages();
        return messages;
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}

// Récupérer les messages depuis Firebase
export const getMessages = async () => {
  try {
    const { data, error } = await supabase.from('messages').select('*');
    if (error) throw error;

    const messages = {
      title: data[0].titre,
      message: data[0].description,
    };

    return messages;
  } catch (error) {
    throw new Error('Failed to fetch messages: ' + error);
  }
};
