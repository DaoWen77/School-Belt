/**
 * 首次引导：创建 owner（建立者）+ 三个验收频道（契约 §12）。
 *
 * 用法：
 *   node --env-file=../ops/.env dist/scripts/init-owner.js
 *   OWNER_HANDLE=founder OWNER_PASSWORD=******** node --env-file=../ops/.env dist/scripts/init-owner.js
 */
import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';

const prisma = new PrismaClient();

const CHANNELS = [
  { name: '全域播报', slug: 'general', topic: '全域广播主频道', visibility: 'public' as const, position: 10 },
  { name: '素材工坊', slug: 'archive', topic: '素材库与归档', visibility: 'public' as const, position: 20 },
  { name: '第三协议', slug: 'protocol', topic: '协作条款内部频道', visibility: 'private' as const, position: 30 },
];

async function main(): Promise<void> {
  const handle = (process.env.OWNER_HANDLE ?? 'founder').toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const displayName = process.env.OWNER_DISPLAY_NAME ?? '建立者';

  if (!password || password.length < 8) {
    console.error('[init-owner] 需要 OWNER_PASSWORD 环境变量（至少 8 位）');
    process.exit(1);
  }

  const existingOwner = await prisma.user.findFirst({
    where: { globalRole: 'owner' },
    select: { handle: true },
  });
  if (existingOwner) {
    console.log(`[init-owner] 已存在建立者：${existingOwner.handle}，跳过`);
    await ensureChannels(existingOwner.handle);
    return;
  }

  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.create({
    data: {
      handle,
      displayName,
      passwordHash,
      globalRole: 'owner',
      lastSeenAt: new Date(),
    },
    select: { id: true, handle: true },
  });
  await prisma.userSetting.create({ data: { userId: user.id } });
  console.log(`[init-owner] 建立者已创建：${user.handle}`);

  await ensureChannels(user.handle);
}

async function ensureChannels(ownerHandle: string): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { handle: ownerHandle },
    select: { id: true },
  });

  for (const channel of CHANNELS) {
    const created = await prisma.channel.upsert({
      where: { slug: channel.slug },
      create: { ...channel, createdBy: owner.id },
      update: {},
      select: { id: true, name: true },
    });
    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId: created.id, userId: owner.id } },
      create: { channelId: created.id, userId: owner.id, role: 'moderator' },
      update: { role: 'moderator' },
    });
    console.log(`[init-owner] 频道就绪：#${created.name}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[init-owner] 失败:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
