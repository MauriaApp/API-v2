import { FastifyInstance } from 'fastify';
import { supabase } from './utils/supabase';

export async function updatesRoute(fastify: FastifyInstance) {
  fastify.get(
    '/updates',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                date: { type: 'string' },
                titleVisu: { type: 'string' },
                contentVisu: { type: 'string' },
                titleDev: { type: 'string' },
                contentDev: { type: 'string' },
              },
              required: [
                'version',
                'date',
                'titleVisu',
                'contentVisu',
                'titleDev',
                'contentDev',
              ],
            },
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
        const updates = await getUpdates();
        return updates;
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}

// Récupérer les updates depuis Firebase
export const getUpdates = async () => {
  try {
    const { data, error } = await supabase.from('changelogs').select('*');
    if (error) throw error;

    // tri des updates par ordre alphabétique
    data.sort((a, b) => {
      return a.titre.localeCompare(b.titre);
    });

    // formatage des données pour les envoyer au client
    return data.map((update) => {
      return {
        version: update.version,
        date: update.date,
        titleVisu: 'Ajouts',
        contentVisu: update.ajouts,
        titleDev: 'Changements',
        contentDev: update.changements,
      };
    });
  } catch (error) {
    throw new Error('Failed to fetch updates: ' + error);
  }
};
