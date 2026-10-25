import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../../config/config.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { NotificationType, NotifyLevel } from '../../common/types/enums';
import { decidePush } from './push-decision';

export interface PushCandidate {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  channelId: string | null;
  payload: Record<string, unknown>;
}

interface WebPushDevice {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface FcmDevice {
  id: string;
  token: string;
}

interface DeliveryResult {
  sent: number;
  failed: number;
  invalidDeviceIds: string[];
}

/**
 * 推送适配层（docs/07 §5 通道选择）：
 * - Web Push：web-push + VAPID；未配置凭据 → push_status=skipped（reason=not_configured）
 * - FCM：legacy HTTP（FCM_SERVER_KEY / FCM_PROJECT_ID）；未配置 → skipped
 * - 决策层见 push-decision.ts（纯函数，单测覆盖）
 * - 失败只更新 push_status，不影响消息主链路；410/404 视为设备失效并删除
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapidReady: boolean;
  private readonly fcmReady: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {
    const push = this.config.push;
    this.vapidReady = Boolean(push.vapidPublicKey && push.vapidPrivateKey);
    this.fcmReady = Boolean(push.fcmServerKey);
    if (this.vapidReady) {
      webpush.setVapidDetails(push.vapidSubject, push.vapidPublicKey as string, push.vapidPrivateKey as string);
    }
  }

  /** 事务提交后 fire-and-forget 调用：不阻塞消息 ack */
  schedule(candidates: readonly PushCandidate[]): void {
    for (const candidate of candidates) {
      void this.dispatch(candidate);
    }
  }

  async dispatch(candidate: PushCandidate): Promise<void> {
    try {
      const decision = await this.decide(candidate);
      if (!decision.push) {
        await this.markStatus(candidate.id, 'skipped');
        this.logger.debug(`通知 ${candidate.id} 不推送：${decision.reason}`);
        return;
      }

      if (!this.config.push.enabled) {
        await this.markStatus(candidate.id, 'skipped');
        return;
      }
      if (!this.vapidReady && !this.fcmReady) {
        await this.markStatus(candidate.id, 'skipped');
        this.logger.debug('未配置 VAPID / FCM 凭据，通知跳过推送');
        return;
      }

      const targets = await this.loadDevices(candidate.userId);
      if (targets.web.length === 0 && targets.fcm.length === 0) {
        await this.markStatus(candidate.id, 'skipped');
        return;
      }

      const [webResult, fcmResult] = await Promise.all([
        this.sendWebPush(targets.web, candidate),
        this.sendFcm(targets.fcm, candidate),
      ]);
      const invalid = [...webResult.invalidDeviceIds, ...fcmResult.invalidDeviceIds];
      if (invalid.length > 0) {
        await this.prisma.device.deleteMany({ where: { id: { in: invalid }, userId: candidate.userId } });
      }
      const sent = webResult.sent + fcmResult.sent;
      await this.markStatus(candidate.id, sent > 0 ? 'sent' : 'failed');
    } catch (error) {
      this.logger.warn(`推送失败（通知 ${candidate.id}）：${(error as Error).message}`);
      await this.markStatus(candidate.id, 'failed');
    }
  }

  /** 决策所需上下文：通知级别、DND 设置、是否在线 */
  private async decide(candidate: PushCandidate) {
    const [settings, member, hasActiveSocket] = await Promise.all([
      this.prisma.userSetting.findUnique({ where: { userId: candidate.userId } }),
      candidate.channelId
        ? this.prisma.channelMember.findUnique({
            where: {
              channelId_userId: {
                channelId: candidate.channelId,
                userId: candidate.userId,
              },
            },
            select: { notifyLevel: true },
          })
        : Promise.resolve(null),
      this.realtime.hasUserConnection(candidate.userId),
    ]);

    return decidePush({
      type: candidate.type,
      channelNotifyLevel: (member?.notifyLevel ?? 'all') as NotifyLevel,
      globalNotifyLevel: (settings?.notifyLevel ?? 'all') as NotifyLevel,
      dndEnabled: settings?.dndEnabled ?? false,
      dndStart: settings?.dndStart ? this.formatTime(settings.dndStart) : null,
      dndEnd: settings?.dndEnd ? this.formatTime(settings.dndEnd) : null,
      timezone: settings?.timezone ?? 'Asia/Shanghai',
      now: new Date(),
      isMention: candidate.type === 'mention',
      hasActiveSocket,
    });
  }

  private formatTime(value: Date): string {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private async loadDevices(userId: string): Promise<{ web: WebPushDevice[]; fcm: FcmDevice[] }> {
    const devices = await this.prisma.device.findMany({ where: { userId } });
    const web: WebPushDevice[] = [];
    const fcm: FcmDevice[] = [];
    for (const device of devices) {
      if (!device.pushToken) continue;
      if (device.pushProvider === 'webpush') {
        const keys = device.pushKeys as { p256dh?: unknown; auth?: unknown } | null;
        if (typeof keys?.p256dh === 'string' && typeof keys.auth === 'string') {
          web.push({ id: device.id, endpoint: device.pushToken, keys: { p256dh: keys.p256dh, auth: keys.auth } });
        }
      } else if (device.pushProvider === 'fcm') {
        fcm.push({ id: device.id, token: device.pushToken });
      }
    }
    return { web, fcm };
  }

  private async sendWebPush(
    devices: readonly WebPushDevice[],
    candidate: PushCandidate,
  ): Promise<DeliveryResult> {
    if (!this.vapidReady) return { sent: 0, failed: 0, invalidDeviceIds: [] };
    const payload = JSON.stringify({
      title: candidate.title,
      body: candidate.body ?? '',
      notificationId: candidate.id,
      data: candidate.payload,
    });
    const result: DeliveryResult = { sent: 0, failed: 0, invalidDeviceIds: [] };
    await Promise.all(
      devices.map(async (device) => {
        try {
          await webpush.sendNotification(
            { endpoint: device.endpoint, keys: device.keys },
            payload,
            { TTL: 300 },
          );
          result.sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            result.invalidDeviceIds.push(device.id);
          } else {
            result.failed += 1;
          }
        }
      }),
    );
    return result;
  }

  private async sendFcm(devices: readonly FcmDevice[], candidate: PushCandidate): Promise<DeliveryResult> {
    if (!this.fcmReady) return { sent: 0, failed: 0, invalidDeviceIds: [] };
    const result: DeliveryResult = { sent: 0, failed: 0, invalidDeviceIds: [] };
    const endpoint = 'https://fcm.googleapis.com/fcm/send';
    const headers = {
      authorization: `key=${this.config.push.fcmServerKey as string}`,
      'content-type': 'application/json',
    };
    await Promise.all(
      devices.map(async (device) => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              to: device.token,
              notification: { title: candidate.title, body: candidate.body ?? '' },
              data: { notificationId: candidate.id, ...candidate.payload },
            }),
          });
          if (!response.ok) {
            result.failed += 1;
            return;
          }
          const body = (await response.json()) as { results?: { error?: string }[] };
          const error = body.results?.[0]?.error;
          if (error === 'NotRegistered' || error === 'InvalidRegistration') {
            result.invalidDeviceIds.push(device.id);
            return;
          }
          if (error) {
            result.failed += 1;
            return;
          }
          result.sent += 1;
        } catch {
          result.failed += 1;
        }
      }),
    );
    return result;
  }

  private async markStatus(
    notificationId: string,
    status: 'sent' | 'failed' | 'skipped',
  ): Promise<void> {
    try {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          pushStatus: status,
          ...(status === 'skipped' ? {} : { pushedAt: new Date() }),
        },
      });
    } catch (error) {
      this.logger.warn(`更新推送状态失败（${notificationId}）：${(error as Error).message}`);
    }
  }
}
