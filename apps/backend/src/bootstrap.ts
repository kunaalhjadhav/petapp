import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppConfig } from './config/app-config.service';
import { requestIdMiddleware } from './common/request-id.middleware';
import { MetricsService } from './observability/metrics';
import { accessLog } from './observability/access-log';
import { ChatGateway } from './modules/chat/chat.gateway';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;

  express.set('trust proxy', config.get('TRUST_PROXY'));
  express.disable('x-powered-by');
  // Express 5 defaults to the 'simple' parser; keep Express 4's behaviour (repeated keys and a[b]=c parse as before).
  express.set('query parser', 'extended');
  express.useBodyParser('json', { limit: '1mb' });
  app.use(requestIdMiddleware);
  app.use(app.get(MetricsService).middleware());
  app.use(accessLog());
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS').length ? config.get('CORS_ORIGINS') : false,
    credentials: true,
  });
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
  app.enableShutdownHooks();
  // Live chat: WebSocket upgrades on /api/v1/chat/ws share the API's HTTP server.
  app.get(ChatGateway).attach(app.getHttpServer());

  const swaggerOn = config.get('SWAGGER_ENABLED') || !config.isProduction;
  if (swaggerOn) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PetApp API')
        .setDescription('PetApp platform API. All responses use the { success, data, message, meta } envelope.')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }
}
