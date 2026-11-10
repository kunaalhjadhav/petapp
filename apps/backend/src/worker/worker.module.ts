import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../providers/storage/storage.module';
import { PushModule } from '../providers/push/push.module';
import { QueueModule } from '../queue/queue.module';
import { NotificationProcessor } from './notification.processor';
import { AuditModule } from '../modules/audit/audit.module';
import { PlatformModule } from '../modules/platform/platform.module';
import { FinanceCoreModule } from '../modules/finance/finance-core.module';
import { ReconciliationService } from '../modules/finance/reconciliation.service';
import { MediaProcessor } from './media.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { WorkerRunner } from './worker.runner';
import { TrustCoreModule } from '../modules/trust/trust-core.module';
import { RecoCoreModule } from '../modules/recommendations/reco-core.module';
import { AssistantRetentionModule } from '../modules/assistant/assistant-retention';
import { ErrorTrackingModule } from '../observability/observability.module';
import { PrivacyCoreModule } from '../modules/privacy/privacy-core.module';
import { SupportAutoClose } from '../modules/chat/support-autoclose';
import { RemindersCoreModule } from '../modules/reminders/reminders.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, StorageModule, AuditModule, PushModule, QueueModule, PlatformModule, FinanceCoreModule, TrustCoreModule, RecoCoreModule, AssistantRetentionModule, PrivacyCoreModule, RemindersCoreModule, ErrorTrackingModule],
  providers: [ReconciliationService, MediaProcessor, MaintenanceProcessor, NotificationProcessor, SupportAutoClose, WorkerRunner],
})
export class WorkerModule {}
