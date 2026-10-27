import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.service';
import { RateLimiterModule } from './common/redis/rate-limiter.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { SurfaceGuard } from './common/guards/surface.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { AuthModule } from './auth/auth.module';
import { InvitesModule } from './invites/invites.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { ReactionsModule } from './reactions/reactions.module';
import { PinsModule } from './pins/pins.module';
import { FilesModule } from './files/files.module';
import { StickersModule } from './stickers/stickers.module';
import { CardsModule } from './cards/cards.module';
import { VotesModule } from './votes/votes.module';
import { PresenceModule } from './presence/presence.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { HealthModule } from './health/health.module';
import { RtcModule } from './rtc/rtc.module';
import { AiModule } from './ai/ai.module';
import { PostsModule } from './posts/posts.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { BeltModule } from './belt/belt.module';
import { SocialModule } from './social/social.module';
import { ModerationModule } from './moderation/moderation.module';
import { FriendshipsModule } from './friendships/friendships.module';
import { RssModule } from './rss/rss.module';
import { DeviceModule } from './device/device.module';
import { WsModule } from './ws/ws.module';

/**
 * 应用根模块。
 * 全局链：JwtAuthGuard（鉴权）→ RolesGuard（全站角色）→ ThrottlerGuard（限流）
 *         → RequestIdInterceptor → TransformInterceptor（统一响应）→ AllExceptionsFilter（统一错误）
 */
@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    RateLimiterModule,
    RealtimeModule,
    // 默认 600 次/分钟/IP，具体端点用 @Throttle 覆盖（契约 §9）
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    AuthModule,
    InvitesModule,
    UsersModule,
    ChannelsModule,
    ConversationsModule,
    MessagesModule,
    ReactionsModule,
    PinsModule,
    FilesModule,
    StickersModule,
    CardsModule,
    VotesModule,
    PresenceModule,
    NotificationsModule,
    SearchModule,
    HealthModule,
    RtcModule,
    AiModule,
    PostsModule,
    AnnouncementsModule,
    OrganizationsModule,
    BeltModule,
    SocialModule,
    ModerationModule,
    FriendshipsModule,
    RssModule,
    DeviceModule,
    WsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 认证之后、角色之前：默认 internal，未标注 @Surface 的路由不会漏给环带。
    { provide: APP_GUARD, useClass: SurfaceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // 限流全局生效：默认 600/min/IP，端点用 @Throttle 覆盖（契约 §9）
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
