/**
 * 验收固定数据种子（对齐契约 §12）。
 *
 * 覆盖：
 * - 角色：1 owner + 1 admin + 6 member；2 公开频道 + 1 私密频道（私密仅 2 人）
 * - 会话（契约 v1.2）：2 条私聊（陈工↔林测绘、岳调度↔沈巡检）+ 2 个群聊（调度夜班、档案校对），各带消息
 * - 消息：520 条（general 416 / archive 84 / protocol 20），含 3 组线程、5 条提及
 * - 反应：20 个（部分挂在提及消息上）
 * - 文件：12 条 ready 元数据（image/pdf/zip 等，无真实对象）+ 1 条 25MB png 拒绝用例记录
 * - 卡片：material×6 / idea×6 / vote×2 / task×4 / artwork×3
 * - 通知：30 条（10 条已读）
 *
 * 用法：
 *   node --env-file=../ops/.env dist/scripts/seed.js
 * 幂等：handle/slug/dm_key 复用；若频道/会话已有消息、文件、卡片则跳过对应段落。
 */
import { PrismaClient } from '@prisma/client';
import { levelOf } from '../social/level';
import { argon2id, hash } from 'argon2';
import { dmKeyOf, dmSlugOf } from '../conversations/conversation-rules';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? 'Dijiang#2026';
const MB = 1024 * 1024;

const USERS = [
  { handle: 'founder', displayName: '建立者', globalRole: 'owner' as const },
  { handle: 'protocol_officer', displayName: '协议官', globalRole: 'admin' as const },
  { handle: 'chen', displayName: '陈工', globalRole: 'member' as const },
  { handle: 'lin', displayName: '林测绘', globalRole: 'member' as const },
  { handle: 'yue', displayName: '岳调度', globalRole: 'member' as const },
  { handle: 'qiu', displayName: '邱档案', globalRole: 'member' as const },
  { handle: 'shen', displayName: '沈巡检', globalRole: 'member' as const },
  { handle: 'an_obs', displayName: '安观测', globalRole: 'member' as const },
];

const CHANNELS = [
  { name: '全域播报', slug: 'general', topic: '全域广播主频道', visibility: 'public' as const, position: 10 },
  { name: '素材工坊', slug: 'archive', topic: '素材库与归档', visibility: 'public' as const, position: 20 },
  { name: '第三协议', slug: 'protocol', topic: '协作条款内部频道', visibility: 'private' as const, position: 30 },
];

/** 契约 v1.2 会话种子：2 条私聊 + 2 个群聊（均沿用上面 8 个既有用户） */
const DM_SEEDS = [
  {
    a: 'chen',
    b: 'lin',
    lines: [
      '陈工：第 3 组测绘图的分辨率我核对过了，可以直接进素材库。',
      '林测绘：收到，我今晚把航拍原片一起补上。',
      '陈工：素材工坊的归档目录记得用协议编号。',
      '林测绘：已按 P-07 编号重排，明早复核。',
      '陈工：好，明天班前会一起过一遍。',
      '林测绘：明白。',
    ],
  },
  {
    a: 'yue',
    b: 'shen',
    lines: [
      '岳调度：本轮调度窗口改到 21:30，巡检请提前半小时就位。',
      '沈巡检：收到，信道噪声已复测，低于阈值。',
      '岳调度：把复测记录发我一份。',
      '沈巡检：已发到素材工坊，文件名 channel-noise.csv。',
      '岳调度：收到，辛苦了。',
      '沈巡检：应该的。',
    ],
  },
] as const;

const GROUP_SEEDS = [
  {
    name: '调度夜班',
    slug: 'seed-group-night-shift',
    creator: 'founder',
    members: ['founder', 'chen', 'lin', 'yue'],
    lines: [
      '建立者：夜班调度群已建立，本班次覆盖 3 个观测点。',
      '岳调度：21:30 窗口已确认，巡检就位。',
      '林测绘：测绘图 B 已更新到素材工坊。',
      '陈工：收到，我核对一下比例尺。',
      '建立者：班中如遇信道异常，先记录再广播。',
      '岳调度：明白。',
      '陈工：比例尺核对通过。',
      '林测绘：收到。',
    ],
  },
  {
    name: '档案校对',
    slug: 'seed-group-archive-review',
    creator: 'protocol_officer',
    members: ['protocol_officer', 'qiu', 'an_obs', 'shen'],
    lines: [
      '协议官：本周档案校对范围是素材工坊的 12 份记录。',
      '邱档案：抽屉第 3 层已按协议编号重排完毕。',
      '安观测：观测点的原始记录我补齐了时间戳。',
      '沈巡检：巡检照片的命名规则也一并对齐了。',
      '协议官：好，周五前出一份校对结论。',
      '邱档案：收到。',
      '安观测：明白。',
      '沈巡检：收到。',
    ],
  },
] as const;

const SENTENCES = [
  '调度记录：第三轮全域信号已同步。',
  '素材工坊新增 3 份测绘档案，等待归档。',
  '协作条款 §4 的权限矩阵已上线，请各频道核对。',
  '本班次广播窗口剩余 12 分钟。',
  '巡检回报：信道噪声低于阈值。',
  '灵感墙新增一张「航测灯带」卡片。',
  '任务指派已更新，请对应负责人确认。',
  '请在 18:00 前回填素材清单。',
  '投票「下一阶段主题」已开启。',
  '工作台调度台完成一次心跳校准。',
  '档案抽屉第 3 层已按协议编号重排。',
  '本轮广播覆盖全部 7 个观测点。',
];

const FILE_FIXTURES = [
  { name: 'survey-map-a.png', mime: 'image/png', kind: 'image' as const, size: 2.4 * MB, w: 1280, h: 720 },
  { name: 'survey-map-b.png', mime: 'image/png', kind: 'image' as const, size: 1.8 * MB, w: 1280, h: 720 },
  { name: 'inspection-photo.jpg', mime: 'image/jpeg', kind: 'image' as const, size: 3.2 * MB, w: 1920, h: 1080 },
  { name: 'aerial-original.jpg', mime: 'image/jpeg', kind: 'image' as const, size: 5.6 * MB, w: 3840, h: 2160 },
  { name: 'protocol-v3.pdf', mime: 'application/pdf', kind: 'document' as const, size: 1.1 * MB },
  { name: 'archive-index.pdf', mime: 'application/pdf', kind: 'document' as const, size: 640 * 1024 },
  { name: 'channel-noise.csv', mime: 'text/plain', kind: 'document' as const, size: 96 * 1024 },
  { name: 'survey-raw.zip', mime: 'application/zip', kind: 'archive' as const, size: 44 * MB },
  { name: 'logs-2026-10.zip', mime: 'application/zip', kind: 'archive' as const, size: 12 * MB },
  { name: 'shift-note.md', mime: 'text/markdown', kind: 'document' as const, size: 18 * 1024 },
  { name: 'beacon-loop.wav', mime: 'audio/wav', kind: 'audio' as const, size: 8 * MB },
  { name: 'dock-timelapse.mp4', mime: 'video/mp4', kind: 'video' as const, size: 68 * MB },
] as const;

const RSS_SEEDS = [
  { name: '少数派', url: 'https://sspai.com/feed', category: 'tech' as const },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', category: 'tech' as const },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed', category: 'tech' as const },
  { name: '机核', url: 'https://www.gcores.com/rss', category: 'game' as const },
  { name: '中新网国际', url: 'https://www.chinanews.com.cn/rss/world.xml', category: 'world' as const },
];

/** 预置真实 RSS 源；按 URL 幂等，不重复插入。 */
async function seedRssSources(ownerId: string | undefined): Promise<void> {
  let created = 0;
  for (const source of RSS_SEEDS) {
    const existing = await prisma.rssSource.findFirst({ where: { url: source.url }, select: { id: true } });
    if (existing) continue;
    await prisma.rssSource.create({
      data: { ...source, createdBy: ownerId ?? null },
    });
    created += 1;
  }
  console.log(`[seed] RSS 源 +${created}（总计 ${RSS_SEEDS.length}）`);
}

async function main(): Promise<void> {
  const passwordHash = await hash(PASSWORD, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const userMap = await seedUsers(passwordHash);
  await seedSocial(passwordHash, userMap);
  const channelMap = await seedChannels(userMap);
  await seedRssSources(userMap.get('founder'));
  await seedConversations(userMap);
  await seedMessages(channelMap, userMap);
  await seedReactions();
  await seedFiles(channelMap, userMap);
  await seedCards(channelMap, userMap);
  await seedNotifications(userMap, channelMap);
  console.log('[seed] 完成');
}

async function seedUsers(passwordHash: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const user of USERS) {
    const row = await prisma.user.upsert({
      where: { handle: user.handle },
      create: { ...user, passwordHash, lastSeenAt: new Date() },
      update: { displayName: user.displayName },
      select: { id: true, handle: true },
    });
    await prisma.userSetting.upsert({
      where: { userId: row.id },
      create: { userId: row.id },
      update: {},
    });
    map.set(row.handle, row.id);
  }
  console.log(`[seed] 用户 ${USERS.length} 个就绪`);
  return map;
}

async function seedChannels(userMap: Map<string, string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const founderId = userMap.get('founder');
  if (!founderId) throw new Error('缺少 founder');

  for (const channel of CHANNELS) {
    const row = await prisma.channel.upsert({
      where: { slug: channel.slug },
      create: { ...channel, createdBy: founderId },
      update: { topic: channel.topic },
      select: { id: true, slug: true, visibility: true },
    });
    map.set(row.slug, row.id);

    const members =
      row.visibility === 'private'
        ? ['founder', 'protocol_officer']
        : USERS.filter((user) => user.globalRole === 'member').map((user) => user.handle);
    for (const handle of members) {
      const userId = userMap.get(handle);
      if (!userId) continue;
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: row.id, userId } },
        create: { channelId: row.id, userId, role: handle === 'founder' ? 'moderator' : 'member' },
        update: {},
      });
    }
  }
  console.log(`[seed] 频道 ${CHANNELS.length} 个就绪（含 1 个私密，仅 2 人）`);
  return map;
}

async function seedMessages(
  channelMap: Map<string, string>,
  userMap: Map<string, string>,
): Promise<void> {
  const generalId = channelMap.get('general');
  const archiveId = channelMap.get('archive');
  const protocolId = channelMap.get('protocol');
  if (!generalId || !archiveId || !protocolId) throw new Error('频道创建失败');

  const existing = await prisma.message.count({ where: { channelId: generalId } });
  if (existing > 0) {
    console.log(`[seed] #general 已有 ${existing} 条信号，跳过消息灌入`);
    return;
  }

  const memberIds = USERS.filter((user) => user.globalRole === 'member')
    .map((user) => userMap.get(user.handle))
    .filter((id): id is string => Boolean(id));
  const founderId = userMap.get('founder');
  const officerId = userMap.get('protocol_officer');
  if (!founderId || !officerId) throw new Error('缺少 owner/admin');

  // 3 组线程：根消息索引 → 两条回复
  const threadRoots = new Map<number, bigint>();
  const threadRootIndexes = new Map<number, number>([
    [1, 0],
    [2, 0],
    [121, 120],
    [122, 120],
    [241, 240],
    [242, 240],
  ]);
  // 5 条提及消息
  const mentionIndexes = new Map<number, string>([
    [50, 'chen'],
    [150, 'lin'],
    [250, 'yue'],
    [350, 'qiu'],
    [450, 'shen'],
  ]);
  const mentionTexts = new Map<string, string>([
    ['chen', '@chen 请确认第 3 组测绘图。'],
    ['lin', '@lin 素材清单 18:00 前回填。'],
    ['yue', '@yue 调度窗口改到 21:30。'],
    ['qiu', '@qiu 档案抽屉需要重新编号。'],
    ['shen', '@shen 巡检回报已收到。'],
  ]);

  let created = 0;
  for (let index = 0; index < 520; index += 1) {
    const channelId =
      index % 10 < 8 ? generalId : index % 10 === 8 ? archiveId : protocolId;
    const senderId =
      channelId === protocolId
        ? index % 2 === 0
          ? founderId
          : officerId
        : (memberIds[index % memberIds.length] ?? founderId);

    const mentionHandle = mentionIndexes.get(index);
    const mentionUserId = mentionHandle ? userMap.get(mentionHandle) : undefined;
    const baseBody = SENTENCES[index % SENTENCES.length] ?? SENTENCES[0] ?? '调度记录';
    const body = mentionTexts.get(mentionHandle ?? '') ?? `${baseBody}（#${index + 1}）`;

    const rootIndex = threadRootIndexes.get(index);
    const parentId = rootIndex !== undefined ? (threadRoots.get(rootIndex) ?? null) : null;
    const threadRootId =
      parentId !== null
        ? (threadRoots.get(rootIndex ?? 0) ?? null)
        : null;

    const message: { id: bigint } = await prisma.message.create({
      data: {
        channelId,
        senderId,
        kind: 'text',
        body,
        clientMsgId: seedUuid(index),
        parentId,
        threadRootId,
        mentions: mentionUserId ? [mentionUserId] : [],
      },
      select: { id: true },
    });

    if (index % 120 === 0 && index < 300) {
      threadRoots.set(index, message.id);
    }
    if (parentId !== null) {
      await prisma.message.update({
        where: { id: parentId },
        data: { threadReplyCount: { increment: 1 }, lastReplyAt: new Date() },
      });
    }
    created += 1;
  }
  console.log(`[seed] 信号 ${created} 条（3 组线程 / 5 条提及）`);
}

/** 反应 ≥20：不同 (user, emoji, message) 组合，命中部分唯一索引时跳过 */
async function seedReactions(): Promise<void> {
  const existing = await prisma.reaction.count();
  if (existing > 0) {
    console.log(`[seed] 已有 ${existing} 个反应，跳过`);
    return;
  }
  const messages = await prisma.message.findMany({
    where: { kind: 'text', deletedAt: null },
    orderBy: { id: 'asc' },
    take: 40,
    select: { id: true },
  });
  const users = await prisma.user.findMany({ orderBy: { handle: 'asc' }, select: { id: true } });
  if (messages.length === 0 || users.length === 0) return;

  const emojis = ['✅', '🛰️', '📡', '🗂️', '⚙️'];
  let created = 0;
  for (let index = 0; index < 20; index += 1) {
    const message = messages[(index * 3) % messages.length];
    const user = users[(index * 2) % users.length];
    const emoji = emojis[index % emojis.length] ?? '✅';
    if (!message || !user) continue;
    try {
      await prisma.reaction.create({ data: { messageId: message.id, userId: user.id, emoji } });
      created += 1;
    } catch {
      // 唯一键冲突（同一用户同一 emoji 同一消息）直接跳过
    }
  }
  console.log(`[seed] 反应 ${created} 个`);
}

async function seedFiles(
  channelMap: Map<string, string>,
  userMap: Map<string, string>,
): Promise<void> {
  const archiveId = channelMap.get('archive');
  const founderId = userMap.get('founder');
  if (!archiveId || !founderId) return;

  const existing = await prisma.file.count({ where: { channelId: archiveId } });
  if (existing > 0) {
    console.log(`[seed] #素材工坊 已有 ${existing} 个文件记录，跳过`);
    return;
  }

  for (const [index, fixture] of FILE_FIXTURES.entries()) {
    await prisma.file.create({
      data: {
        ownerId: founderId,
        channelId: archiveId,
        bucket: process.env.S3_BUCKET ?? 'dijiang',
        storageKey: `seed/archive/${index + 1}-${fixture.name}`,
        originalName: fixture.name,
        mime: fixture.mime,
        kind: fixture.kind,
        sizeBytes: BigInt(Math.round(fixture.size)),
        width: 'w' in fixture ? fixture.w : null,
        height: 'h' in fixture ? fixture.h : null,
        // 仅为验收列表/筛选提供元数据，不对应真实对象（S3 中不存在）
        status: 'ready',
        previewStatus: fixture.kind === 'image' ? 'pending' : 'none',
      },
    });
  }

  // 契约 §12 拒绝用例：25MB png 记录（超过 20MB 图片上限），不落对象
  await prisma.file.create({
    data: {
      ownerId: founderId,
      channelId: archiveId,
      bucket: process.env.S3_BUCKET ?? 'dijiang',
      storageKey: 'seed/archive/oversize-25mb.png',
      originalName: 'oversize-25mb.png',
      mime: 'image/png',
      kind: 'image',
      sizeBytes: BigInt(25 * MB),
      width: 6000,
      height: 4000,
      status: 'rejected',
      previewStatus: 'none',
    },
  });
  console.log(`[seed] 文件记录 ${FILE_FIXTURES.length} 条 ready + 1 条 25MB png rejected（仅元数据）`);
}

async function seedCards(
  channelMap: Map<string, string>,
  userMap: Map<string, string>,
): Promise<void> {
  const generalId = channelMap.get('general');
  const archiveId = channelMap.get('archive');
  const founderId = userMap.get('founder');
  if (!generalId || !archiveId || !founderId) return;

  const existing = await prisma.card.count();
  if (existing > 0) {
    console.log(`[seed] 已有 ${existing} 张卡片，跳过卡片灌入`);
    return;
  }

  const materialLabels = ['测绘图 A', '测绘图 B', '巡检影像', '航拍原片', '协议附件', '归档压缩包'];
  for (const [index, label] of materialLabels.entries()) {
    await prisma.card.create({
      data: {
        channelId: archiveId,
        kind: 'material',
        title: label,
        tags: ['测绘', index % 2 === 0 ? '原始' : '归档'],
        position: 1000 + index,
        createdBy: founderId,
        data: { fileCount: 2 },
      },
    });
  }

  const ideaLabels = ['灯带布局', '调度台色标', '信道分区', '档案标签', '广播节奏', '巡检路线'];
  const colors = ['amber', 'teal', 'rose', 'violet', 'slate'] as const;
  for (const [index, label] of ideaLabels.entries()) {
    await prisma.card.create({
      data: {
        channelId: generalId,
        kind: 'idea',
        title: label,
        body: '灵感墙草稿，待评审。',
        color: colors[index % colors.length] ?? 'amber',
        position: 1000 + index,
        createdBy: founderId,
      },
    });
  }

  for (const config of [
    { multi: false, anonymous: false, title: '下一阶段主题（单选）' },
    { multi: true, anonymous: true, title: '下一阶段主题（多选·匿名）' },
  ]) {
    const card = await prisma.card.create({
      data: {
        channelId: generalId,
        kind: 'vote',
        title: config.title,
        status: 'open',
        position: 2000,
        createdBy: founderId,
        data: {
          multi: config.multi,
          anonymous: config.anonymous,
          closesAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        },
      },
    });
    for (const [index, label] of ['航测', '档案', '广播'].entries()) {
      await prisma.voteOption.create({ data: { cardId: card.id, label, position: index } });
    }
  }

  for (let index = 0; index < 4; index += 1) {
    await prisma.card.create({
      data: {
        channelId: generalId,
        kind: 'task',
        title: `任务 ${index + 1}：信号校准`,
        status: index === 3 ? 'done' : 'open',
        taskStatus: index === 0 ? 'todo' : index === 3 ? 'done' : 'doing',
        position: 3000 + index,
        createdBy: founderId,
        dueAt: new Date(Date.now() + (index + 1) * 24 * 3600_000),
      },
    });
  }

  for (let index = 0; index < 3; index += 1) {
    await prisma.card.create({
      data: {
        channelId: archiveId,
        kind: 'artwork',
        title: `作品 ${index + 1}`,
        status: 'open',
        position: 4000 + index,
        createdBy: founderId,
        data: { caption: '航测档案渲染稿' },
      },
    });
  }
  console.log('[seed] 卡片 material×6 / idea×6 / vote×2 / task×4 / artwork×3');
}

async function seedNotifications(
  userMap: Map<string, string>,
  channelMap: Map<string, string>,
): Promise<void> {
  const generalId = channelMap.get('general');
  const chenId = userMap.get('chen');
  if (!generalId || !chenId) return;
  const existing = await prisma.notification.count();
  if (existing > 0) {
    console.log(`[seed] 已有 ${existing} 条通知，跳过`);
    return;
  }
  for (let index = 0; index < 30; index += 1) {
    await prisma.notification.create({
      data: {
        userId: chenId,
        type: index % 3 === 0 ? 'mention' : index % 3 === 1 ? 'thread_reply' : 'system',
        channelId: generalId,
        title: index % 3 === 0 ? '你在 #全域播报 被提及' : '调度记录更新',
        body: SENTENCES[index % SENTENCES.length] ?? '',
        readAt: index < 10 ? new Date() : null,
        payload: { channelId: generalId },
      },
    });
  }
  console.log('[seed] 通知 30 条（10 条已读）');
}

/**
 * 契约 v1.2 会话种子：2 条私聊 + 2 个群聊，各自带消息。
 * 幂等：私聊按 dm_key 找、群聊按 slug 找；已有消息则跳过该会话的消息段。
 */
async function seedConversations(userMap: Map<string, string>): Promise<void> {
  let dmCreated = 0;
  for (const [index, seed] of DM_SEEDS.entries()) {
    const userA = userMap.get(seed.a);
    const userB = userMap.get(seed.b);
    if (!userA || !userB) continue;

    const dmKey = dmKeyOf(userA, userB);
    let channel = await prisma.channel.findFirst({
      where: { dmKey },
      select: { id: true },
    });
    if (!channel) {
      channel = await prisma.channel.create({
        data: {
          name: '', // 契约 v1.2 §A1：DM 名称允许空串，前端用对方显示名渲染
          slug: dmSlugOf(dmKey, 'internal'),
          visibility: 'private',
          kind: 'dm',
          dmKey,
          position: 0,
          createdBy: userA,
        },
        select: { id: true },
      });
      dmCreated += 1;
    }

    for (const userId of [userA, userB]) {
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId } },
        create: { channelId: channel.id, userId, role: 'member' },
        update: {},
      });
    }
    await seedConversationMessages(channel.id, [userA, userB], seed.lines, 900_000 + index * 100);
  }

  let groupCreated = 0;
  for (const [index, seed] of GROUP_SEEDS.entries()) {
    const creatorId = userMap.get(seed.creator);
    if (!creatorId) continue;
    let channel = await prisma.channel.findUnique({
      where: { slug: seed.slug },
      select: { id: true },
    });
    if (!channel) {
      channel = await prisma.channel.create({
        data: {
          name: seed.name,
          slug: seed.slug,
          visibility: 'private',
          kind: 'group',
          position: 0,
          createdBy: creatorId,
        },
        select: { id: true },
      });
      groupCreated += 1;
    }

    const memberIds = seed.members
      .map((handle) => userMap.get(handle))
      .filter((id): id is string => Boolean(id));
    for (const userId of memberIds) {
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId } },
        create: {
          channelId: channel.id,
          userId,
          role: userId === creatorId ? 'moderator' : 'member',
        },
        update: {},
      });
    }
    await seedConversationMessages(
      channel.id,
      memberIds,
      seed.lines,
      910_000 + index * 100,
    );
  }

  console.log(
    `[seed] 会话 ${DM_SEEDS.length} 条私聊（新建 ${dmCreated}）+ ${GROUP_SEEDS.length} 个群聊（新建 ${groupCreated}）`,
  );
}

/** 会话内消息：按发送者轮转，createdAt 依次递增；顺带回填 channels.last_message_at */
async function seedConversationMessages(
  channelId: string,
  senderIds: readonly string[],
  lines: readonly string[],
  uuidBase: number,
): Promise<void> {
  const existing = await prisma.message.count({ where: { channelId } });
  if (existing > 0) return;
  if (senderIds.length === 0) return;

  let lastCreatedAt: Date | null = null;
  for (const [index, line] of lines.entries()) {
    const senderId = senderIds[index % senderIds.length];
    if (!senderId) continue;
    const createdAt = new Date(Date.now() - (lines.length - index) * 60_000);
    await prisma.message.create({
      data: {
        channelId,
        senderId,
        kind: 'text',
        body: line,
        clientMsgId: seedUuid(uuidBase + index),
        createdAt,
      },
    });
    lastCreatedAt = createdAt;
  }

  if (lastCreatedAt) {
    await prisma.channel.update({
      where: { id: channelId },
      data: { lastMessageAt: lastCreatedAt },
    });
  }
}

/** ── 模块一/二演示数据：风纪委 / 创作者 / 候选委员，外加委托、服务与一张 open 工单（幂等） ── */
const SOCIAL_USERS = [
  { handle: 'clerk1', displayName: '风纪一号', tags: ['风纪委员'], exp: 320 },
  { handle: 'creator', displayName: '委托主', tags: ['教师'], exp: 640 },
  { handle: 'applicant', displayName: '候选风纪', tags: [], exp: 305 },
] as const;

async function seedSocial(passwordHash: string, userMap: Map<string, string>): Promise<void> {
  for (const item of SOCIAL_USERS) {
    const row = await prisma.user.upsert({
      where: { handle: item.handle },
      create: {
        handle: item.handle,
        displayName: item.displayName,
        passwordHash,
        globalRole: 'member',
        accountOrigin: 'belt',
        tags: [...item.tags],
        exp: item.exp,
        level: levelOf(item.exp),
        lastSeenAt: new Date(),
      },
      update: {
        displayName: item.displayName,
        tags: [...item.tags],
        exp: item.exp,
        level: levelOf(item.exp),
      },
      select: { id: true },
    });
    await prisma.userSetting.upsert({
      where: { userId: row.id },
      create: { userId: row.id },
      update: {},
    });
    userMap.set(item.handle, row.id);
  }

  const creator = userMap.get('creator');
  const clerk = userMap.get('clerk1');
  const applicant = userMap.get('applicant');
  if (!creator || !clerk || !applicant) return;

  // 关注关系（个人主页计数与 isFollowing）
  for (const [followerId, followingId] of [
    [creator, clerk],
    [applicant, creator],
    [creator, applicant],
  ] as const) {
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });
  }

  // 环塔电文（个人主页 Tab1）
  const posts = [
    {
      index: 9101,
      authorId: creator,
      board: 'daily' as const,
      title: '外环静默期随笔',
      body: '外环静默期的第三夜，中继塔的灯还亮着。',
    },
    {
      index: 9102,
      authorId: creator,
      board: 'bounty' as const,
      title: '求一份航拍原片校色',
      body: '第三次航拍的原片需要统一色温，预算 200 元。',
    },
    {
      index: 9103,
      authorId: clerk,
      board: 'daily' as const,
      title: '本周治理通告',
      body: '本周共受理 12 张工单，其中 3 张已结案。',
    },
  ];
  for (const post of posts) {
    await prisma.post.upsert({
      where: { id: seedUuid(post.index) },
      create: {
        id: seedUuid(post.index),
        authorId: post.authorId,
        surface: 'belt',
        board: post.board,
        title: post.title,
        body: post.body,
        source: 'user',
        publishedAt: new Date(),
      },
      update: { title: post.title, body: post.body },
    });
  }

  // 委托（Tab2）与服务（Tab3）
  const commissions = [
    { index: 9121, title: '航拍原片校色', description: '12 条 4K 原片统一色温', priceCents: 20000, status: 'open' as const },
    { index: 9122, title: '中继塔巡检记录整理', description: '把纸质记录录入系统', priceCents: 8000, status: 'in_progress' as const },
  ];
  for (const item of commissions) {
    await prisma.task.upsert({
      where: { id: seedUuid(item.index) },
      create: {
        id: seedUuid(item.index),
        creatorId: creator,
        title: item.title,
        description: item.description,
        priceCents: item.priceCents,
        status: item.status,
      },
      update: { title: item.title, status: item.status },
    });
  }

  const services = [
    { index: 9131, owner: 'clerk1', title: '测绘数据处理', description: '航测原片拼接与出图', priceCents: 50000 },
    { index: 9132, owner: 'clerk1', title: '环塔导览讲解', description: '每小时一次，含中继塔内部', priceCents: null },
    { index: 9133, owner: 'creator', title: '环塔摄影跟拍', description: '半天跟拍，含精修 20 张', priceCents: 30000 },
  ];
  for (const item of services) {
    await prisma.service.upsert({
      where: { id: seedUuid(item.index) },
      create: {
        id: seedUuid(item.index),
        userId: item.owner === 'creator' ? creator : clerk,
        title: item.title,
        description: item.description,
        priceCents: item.priceCents,
      },
      update: { title: item.title },
    });
  }

  // 工单池首屏：3 张 open 工单（不同帖子 / 不同举报人）
  const qiu = userMap.get('qiu');
  const reports = [
    {
      index: 9141,
      reporterId: applicant,
      targetId: seedUuid(9101),
      reason: 'spam' as const,
      detail: '该电文重复发布三次，疑似刷屏。',
    },
    {
      index: 9142,
      reporterId: qiu ?? applicant,
      targetId: seedUuid(9102),
      reason: 'harassment' as const,
      detail: '回波区出现指向性嘲讽，请求复核。',
    },
    {
      index: 9143,
      reporterId: clerk,
      targetId: seedUuid(9101),
      reason: 'illegal' as const,
      detail: '正文夹带可疑外链，疑似引流。',
    },
  ];
  for (const item of reports) {
    await prisma.report.upsert({
      where: { id: seedUuid(item.index) },
      create: {
        id: seedUuid(item.index),
        reporterId: item.reporterId,
        targetType: 'post',
        targetId: item.targetId,
        subjectUserId: creator,
        reason: item.reason,
        detail: item.detail,
        status: 'open',
      },
      update: {},
    });
  }

  // 获赞数演示：给 creator 的帖子补真实点赞（主页「获赞」不再是 0）
  const likeUsers = [userMap.get('founder'), qiu, clerk, applicant].filter((id): id is string => Boolean(id));
  for (const [postId, likers] of [
    [seedUuid(9101), likeUsers],
    [seedUuid(9102), likeUsers.slice(0, 2)],
  ] as const) {
    for (const userId of likers) {
      await prisma.postLike.upsert({
        where: { postId_userId: { postId, userId } },
        create: { postId, userId },
        update: {},
      });
    }
    const likeCount = await prisma.postLike.count({ where: { postId } });
    console.log(`[seed] 帖子 ${postId.slice(0, 4)} 点赞 ${likeCount}`);
  }

  // 候选委员的待审申请（Founder 审批页）
  await prisma.clerkApplication.upsert({
    where: { id: seedUuid(9151) },
    create: {
      id: seedUuid(9151),
      userId: applicant,
      status: 'pending',
      reason: '常驻环塔三年，愿意参与内容治理与工单复核。',
      snapshotLevel: levelOf(305),
      snapshotViolations: 0,
    },
    update: {},
  });

  console.log('[seed] 社交/风纪演示数据就绪（clerk1 / creator / applicant）');
}

/** 生成稳定的 uuid v4（种子可重复，client_msg_id 幂等键不冲突） */
function seedUuid(index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

main()
  .catch((error: unknown) => {
    console.error('[seed] 失败:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
