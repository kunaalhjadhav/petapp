import { Module } from '@nestjs/common';
import { LegalService } from './legal.service';
import { PrivacyAdminService } from './privacy-admin.service';
import { AdminLegalController, AdminPrivacyController, LegalController, MyPrivacyController } from './privacy.controller';

/** Privacy and legal (Phase 8b): legal documents, consents, data exports and account deletion. */
@Module({
  controllers: [LegalController, MyPrivacyController, AdminLegalController, AdminPrivacyController],
  providers: [LegalService, PrivacyAdminService],
  exports: [LegalService],
})
export class PrivacyModule {}
