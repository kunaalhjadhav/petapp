import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScaledThrottlerGuard } from './common/throttler/scaled-throttler.guard';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { RedisService } from './redis/redis.service';
import { SmsModule } from './providers/sms/sms.module';
import { EmailModule } from './providers/email/email.module';
import { MapsModule } from './providers/maps/maps.module';
import { AuditModule } from './modules/audit/audit.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PetsModule } from './modules/pets/pets.module';
import { HealthModule } from './modules/health/health.module';
import { StorageModule } from './providers/storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { MediaModule } from './modules/media/media.module';
import { PostsModule } from './modules/posts/posts.module';
import { TrustModule } from './modules/trust/trust.module';
import { RecoCoreModule } from './modules/recommendations/reco-core.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { ErrorTrackingModule, MetricsModule } from './observability/observability.module';
import { AssistantRetentionModule } from './modules/assistant/assistant-retention';
import { SafetyModule } from './modules/safety/safety.module';
import { PrivacyCoreModule } from './modules/privacy/privacy-core.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { PublicModule } from './modules/public/public.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FinanceCoreModule } from './modules/finance/finance-core.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ContestsModule } from './modules/contests/contests.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { ServicesModule } from './modules/services/services.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ChatModule } from './modules/chat/chat.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { LocationsModule } from './modules/locations/locations.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { SearchModule } from './modules/search/search.module';
import { DiscoverModule } from './modules/discover/discover.module';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { FeatureGuard } from './modules/platform/feature.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    JwtModule.register({ global: true }),
    SmsModule,
    EmailModule,
    MapsModule,
    AuditModule,
    RbacModule,
    PlatformModule,
    AuthModule,
    UsersModule,
    PetsModule,
    StorageModule,
    QueueModule,
    MediaModule,
    PostsModule,
    SafetyModule,
    TrustModule,
    RecoCoreModule,
    RecommendationsModule,
    AssistantModule,
    ErrorTrackingModule,
    MetricsModule,
    AssistantRetentionModule,
    NotificationsModule,
    FinanceCoreModule,
    PaymentsModule,
    FinanceModule,
    ContestsModule,
    ChallengesModule,
    ServicesModule,
    MarketplaceModule,
    ChatModule,
    ReviewsModule,
    LocationsModule,
    AnalyticsModule,
    MembershipsModule,
    RemindersModule,
    SearchModule,
    DiscoverModule,
    PrivacyCoreModule,
    PrivacyModule,
    PublicModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limit → authenticate → authorise → feature flag.
    { provide: APP_GUARD, useClass: ScaledThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useExisting: FeatureGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
