import { Global, Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { DataExportService } from './data-export.service';
import { AccountEraser } from './account-eraser';

/** Shared by the API and the worker: consents (checked by onboarding and contest entry), data exports and erasure. */
@Global()
@Module({ providers: [ConsentService, DataExportService, AccountEraser], exports: [ConsentService, DataExportService, AccountEraser] })
export class PrivacyCoreModule {}
