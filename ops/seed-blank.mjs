#!/usr/bin/env node
/**
 * 空数据初始化：只建「环带频道」一个公共频道，其余全部留空。
 * 幂等：频道按 slug 查找，存在就复用。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?schema=public' } },
});

try {
  const founder = await prisma.user.findUnique({ where: { handle: 'founder' }, select: { id: true } });
  const existing = await prisma.channel.findFirst({ where: { slug: 'belt', surface: 'belt' } });
  const channel =
    existing ??
    (await prisma.channel.create({
      data: {
        name: '环带频道',
        slug: 'belt',
        topic: '公开实时公共频道 · 所有环带身份可发言',
        kind: 'channel',
        surface: 'belt',
        visibility: 'public',
        position: 10,
        createdBy: founder?.id ?? null,
      },
    }));
  console.log('[blank] 频道就绪', channel.id, channel.name);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
