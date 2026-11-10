import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { JsonLogger } from './observability/json-logger';
import { ERROR_TRACKER, type ErrorTracker } from './observability/error-tracker';

/** Background worker: media processing and scheduled maintenance. Same image as the API, different command. */
async function main() {
  process.env.PETAPP_SERVICE = 'worker';
  const logger = JsonLogger.fromEnv(process.env, 'worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger });
  const tracker = app.get<ErrorTracker>(ERROR_TRACKER);
  process.on('unhandledRejection', (e) => {
    logger.error(e instanceof Error ? e : String(e), 'UnhandledRejection');
    tracker.capture(e, { tags: { kind: 'unhandledRejection' } });
  });
  app.enableShutdownHooks();
  Logger.log('PetApp worker running', 'Bootstrap');
}

void main();
