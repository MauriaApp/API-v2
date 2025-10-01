import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import aurionRoutes from './routes/aurion/index';
import supaDataRoutes from './routes/supa-data/index';

import Sentry from '@sentry/node';
import './utils/sentry';

import dotenv from 'dotenv';
import fastifyCors from '@fastify/cors';
const isDev = process.env.TS_NODE_DEV;
if (isDev) {
  console.log('-- Running in development mode');
}
const envFile = isDev ? '.env.dev' : '.env';
dotenv.config({ path: envFile, override: true, quiet: true });

const port = process.env.PORT || 8080;
const host = process.env.HOST || '0.0.0.0';

const app = Fastify({ logger: false });

Sentry.setupFastifyErrorHandler(app as any);

const start = async () => {
  try {
    // Register CORS plugin
    await app.register(fastifyCors, {
      origin: true,
      credentials: true,
    });

    // Enregistrer Swagger en premier
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'API Mauria',
          description:
            'API propre avec Fastify, TypeScript et Swagger. Toutes les routes sont documentées ici, avec exemples de requêtes et réponses.',
          version: '2.0.0',
        },
      },
    });

    // Routes Aurion
    await Promise.all(
      Object.values(aurionRoutes).map((route) => app.register(route))
    );
    // Routes SupaData
    await Promise.all(
      Object.values(supaDataRoutes).map((route) => app.register(route))
    );

    await app.register(swaggerUi, {
      routePrefix: '/',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });

    await app.listen({ port: Number(port), host });
    if (isDev) {
      console.log(`Server listening at + Swagger http://${host}:${port}`);
    }
  } catch (err) {
    Sentry.captureException(err);
    app.log.error(err);
    process.exit(1);
  }
};

start();
