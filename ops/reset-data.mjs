#!/usr/bin/env node
/**
 * 数据清空（保留结构与角色账号）
 *
 * 保留：users（含 tags/level/exp）、organizations、org members、invites、ai_settings、bot_profiles、
 *       stickers 定义、user_settings、devices/sessions（登录态）、system_announcements？→ 清空
 * 清空：频道与消息、会话、通知、动态/帖子/评论/点赞/收藏、任务与托管、羁绊、举报投票、审计、
 *       流水与余额复位（默认 50 券）、上传的文件记录与 S3 对象、表情包、屏蔽/隐藏、活动
 *
 * 用法：node ops/reset-data.mjs [--dry] [--reset-balance]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const DRY = process.argv.includes('--dry');
const RESET_BALANCE = process.argv.includes('--reset-balance');

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?schema=public' } },
});

/** 清空顺序：先子表后父表；BigInt 主键表逐条安全删除 */
const PLAN = [
  // 互动 / 内容
  ['postBookmark', {}],
  ['postLike', {}],
  ['postComment', {}],
  ['post', {}],
  ['rssItem', {}],
  ['reaction', {}],
  ['attachment', {}],
  ['pin', {}],
  ['cardAssignee', {}],
  ['voteBallot', {}],
  ['voteOption', {}],
  ['card', {}],
  ['messageHide', {}],
  ['message', {}],
  ['channelMember', {}],
  ['directClear', {}],
  ['channel', {}],
  ['conversationMember', {}],
  ['conversation', {}],
  // 社交 / 风纪 / 交易 / 羁绊
  ['follow', {}],
  ['expLog', {}],
  ['report', {}],
  ['moderationVote', {}],
  ['clerkApplication', {}],
  ['bond', {}],
  ['escrow', {}],
  ['taskApplication', {}],
  ['task', {}],
  ['service', {}],
  ['sticker', {}],
  ['userBlock', {}],
  ['block', {}],
  // 通知 / 设备 / 会话
  ['notification', {}],
  ['auditLog', {}],
  ['session', {}],
  ['device', {}],
  ['deviceToken', {}],
  ['deviceBindCode', {}],
  ['invite', {}],
  // 资金
  ['ledgerEntry', {}],
];

const report = [];
try {
  for (const [model, where] of PLAN) {
    if (!prisma[model]) {
      report.push({ model, skipped: 'model-not-found' });
      continue;
    }
    const before = await prisma[model].count();
    if (DRY) {
      report.push({ model, before, wouldDelete: before });
      continue;
    }
    const result = await prisma[model].deleteMany({ where });
    report.push({ model, before, deleted: result.count });
  }

  if (RESET_BALANCE && !DRY) {
    const reset = await prisma.user.updateMany({
      where: { handle: { notIn: ['platform_treasury'] } },
      data: { balanceCents: 5000 },
    });
    report.push({ model: 'user.balanceCents', reset: reset.count });
  }
  if (!DRY && prisma.systemAnnouncement) {
    await prisma.systemAnnouncement.updateMany({ data: { active: false } }).catch(() => {});
    report.push({ model: 'systemAnnouncement', note: 'closed (active=false)' });
  }
} catch (error) {
  report.push({ fatal: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(ROOT, 'reports', 'e2e', 'reset-data.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const row of report) console.log(JSON.stringify(row));
  await prisma.$disconnect();
}
