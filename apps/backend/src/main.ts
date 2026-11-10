import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import { configureApp } from './bootstrap';
import { JsonLogger } from './observability/json-logger';
import { ERROR_TRACKER, type ErrorTracker } from './observability/error-tracker';

async function main() {
  // rawBody: payment webhooks verify signatures over the exact bytes received.
  const logger = JsonLogger.fromEnv(process.env, 'api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true, logger });
  const tracker = app.get<ErrorTracker>(ERROR_TRACKER);
  process.on('unhandledRejection', (e) => {
    logger.error(e instanceof Error ? e : String(e), 'UnhandledRejection');
    tracker.capture(e, { tags: { kind: 'unhandledRejection' } });
  });
  configureApp(app);
  const port = app.get(AppConfig).get('PORT');
  await app.listen(port, '0.0.0.0');
  Logger.log(`PetApp API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}

void main();
