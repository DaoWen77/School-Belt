#!/usr/bin/env node
/**
 * Phase B 验证（真实 API + 真实 PG）：
 *   - 普通内部用户申请组织，全站 Owner 审批；
 *   - 审批通过后默认私有频道创建，组织 Owner 前缀 [组织]Official；
 *   - 成员申请/组织内审批，成员前缀 [组织]；
 *   - 组织频道仅组织成员可见；全站 Owner 读不到；
 *   - 组织内建私有频道、转让 Owner、解散；
 *   - 全站 Owner 不能申请/加入组织。
 *
 * 用法：cd server && DATABASE_URL=... node test/phase-b.e2e.mjs
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const UA = 'phase-b-probe/1.0';
const prisma = new PrismaClient();
const suffix = Date.now().toString(36).slice(-5);
const orgName = `B测组${suffix}`;
const checks = [];
let orgId = null;
let defaultChannelId = null;
let secondChannelId = null;

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  checks.push(label);
  console.log(`✓ ${label}`);
}

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'user-agent': UA,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

const data = (response) => response.json?.data;
const code = (response) => response.json?.error?.code ?? response.json?.code;

async function login(handle) {
  const response = await call('/auth/login', {
    method: 'POST',
    body: { handle, password: 'Dijiang#2026' },
  });
  check(response.status === 200, `${handle} 登录`);
  return data(response).accessToken;
}

async function me(token) {
  const response = await call('/me', { token });
  check(response.status === 200, '/me');
  return data(response).user;
}

async function cleanup() {
  if (!orgId) return;
  const channels = await prisma.channel.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const channelIds = channels.map((channel) => channel.id);
  await prisma.channelMember.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.message.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

async function main() {
  const chen = await login('chen');
  const lin = await login('lin');
  const founder = await login('founder');

  const chenMe = await me(chen);
  const linMe = await me(lin);
  check(chenMe.prefixes.includes('[站长]'), '系统证章存在');
  check(chenMe.prefixes.some((prefix) => prefix.startsWith('[') && !prefix.startsWith('[站长]')) === false, '申请前无组织证章');

  const ownerApply = await call('/organizations', {
    method: 'POST',
    token: founder,
    body: { name: `Owner测${suffix}`, summary: 'Owner 不应能申请组织' },
  });
  check(ownerApply.status === 403, '全站 Owner 不能申请组织', `${ownerApply.status}/${code(ownerApply)}`);

  const apply = await call('/organizations', {
    method: 'POST',
    token: chen,
    body: { name: orgName, summary: 'B 阶段真实链路验证组织' },
  });
  check(apply.status === 201, '普通用户申请组织 201');
  orgId = data(apply).organization.id;
  check(data(apply).organization.status === 'pending', '申请状态 pending');

  const pending = await call('/organizations/pending', { token: founder });
  check(
    pending.status === 200 && data(pending).organizations.some((org) => org.id === orgId),
    '全站 Owner 可见待审组织',
  );

  const review = await call(`/organizations/${orgId}/review`, {
    method: 'PATCH',
    token: founder,
    body: { action: 'approve' },
  });
  check(review.status === 200, 'Owner 审批通过 200');
  const approved = data(review).organization;
  check(approved.status === 'active', '组织 active');
  const defaultChannel = await prisma.channel.findFirst({
    where: { organizationId: orgId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, visibility: true, surface: true, organizationId: true },
  });
  check(Boolean(defaultChannel), '审批通过自动创建默认私有频道');
  check(defaultChannel?.name.includes('议事厅') === true, '默认频道名包含议事厅');
  check(
    defaultChannel?.visibility === 'private' &&
      defaultChannel?.surface === 'internal' &&
      defaultChannel?.organizationId === orgId,
    '默认频道是 internal + private + organizationId',
  );
  defaultChannelId = defaultChannel?.id ?? null;
  check(Boolean(defaultChannelId), '默认频道 ID 存在');

  const chenAfter = await me(chen);
  check(chenAfter.prefixes.includes(`[${orgName}]Official`), '组织 Owner 获得 [组织]Official');
  check(chenAfter.prefixes.includes('[站长]'), '组织 Owner 仍保留系统证章');

  const linJoin = await call(`/organizations/${orgId}/join`, {
    method: 'POST',
    token: lin,
    body: { note: '希望加入 B 测组' },
  });
  check(linJoin.status === 201, '成员申请加入 201');
  check(data(linJoin).organization.myStatus === 'pending', '成员状态 pending');

  const requests = await call(`/organizations/${orgId}/requests`, { token: chen });
  check(
    requests.status === 200 && data(requests).requests.some((member) => member.userId === linMe.id),
    '组织 Owner 可见加入申请',
  );

  const approveMember = await call(`/organizations/${orgId}/requests/${linMe.id}`, {
    method: 'PATCH',
    token: chen,
    body: { action: 'approve' },
  });
  check(approveMember.status === 200, '组织 Owner 通过成员申请 200');

  const linAfter = await me(lin);
  check(linAfter.prefixes.includes(`[${orgName}]`), '普通成员获得 [组织]');
  check(!linAfter.prefixes.includes(`[${orgName}]Official`), '普通成员没有 Official');

  const chenChannels = await call('/channels', { token: chen });
  const chenOrgChannel = data(chenChannels).channels.find((channel) => channel.organizationId === orgId);
  check(Boolean(chenOrgChannel), '组织 Owner 的 /channels 包含组织频道');

  const founderChannels = await call('/channels', { token: founder });
  check(
    !data(founderChannels).channels.some((channel) => channel.organizationId === orgId),
    '全站 Owner 的 /channels 不包含组织频道',
  );

  const founderChannel = await call(`/channels/${defaultChannelId}`, { token: founder });
  check(founderChannel.status === 404, '全站 Owner 直接读组织频道 404', `${founderChannel.status}`);
  const founderMessages = await call(`/channels/${defaultChannelId}/messages`, { token: founder });
  check(founderMessages.status === 404, '全站 Owner 读组织频道消息 404', `${founderMessages.status}`);

  const linMessages = await call(`/channels/${defaultChannelId}/messages`, { token: lin });
  check(linMessages.status === 200, '组织成员可读组织频道消息');

  const memberCreate = await call(`/organizations/${orgId}/channels`, {
    method: 'POST',
    token: lin,
    body: { name: '成员越权频道' },
  });
  check(memberCreate.status === 403, '普通成员不能建组织频道', `${memberCreate.status}/${code(memberCreate)}`);

  const createChannel = await call(`/organizations/${orgId}/channels`, {
    method: 'POST',
    token: chen,
    body: { name: '测绘二组', topic: 'B 阶段第二频道' },
  });
  check(createChannel.status === 201, '组织 Owner 建私有频道 201');
  secondChannelId = data(createChannel).channel.id;
  check(Boolean(secondChannelId), '第二频道 ID 存在');

  const founderSecond = await call(`/channels/${secondChannelId}`, { token: founder });
  check(founderSecond.status === 404, '全站 Owner 读第二组织频道 404');

  const transfer = await call(`/organizations/${orgId}/transfer`, {
    method: 'POST',
    token: chen,
    body: { userId: linMe.id },
  });
  check(transfer.status === 200, '组织 Owner 转让 200');
  const chenAfterTransfer = await me(chen);
  const linAfterTransfer = await me(lin);
  check(chenAfterTransfer.prefixes.includes(`[${orgName}]`), '原 Owner 降为普通证章');
  check(linAfterTransfer.prefixes.includes(`[${orgName}]Official`), '新 Owner 获得 Official');

  const oldOwnerDissolve = await call(`/organizations/${orgId}/dissolve`, {
    method: 'POST',
    token: chen,
    body: {},
  });
  check(oldOwnerDissolve.status === 403, '非组织 Owner 不能解散', `${oldOwnerDissolve.status}/${code(oldOwnerDissolve)}`);

  const dissolve = await call(`/organizations/${orgId}/dissolve`, {
    method: 'POST',
    token: lin,
    body: {},
  });
  check(dissolve.status === 200, '新 Owner 解散组织 200');

  const chenAfterDissolve = await me(chen);
  const linAfterDissolve = await me(lin);
  check(!chenAfterDissolve.prefixes.some((prefix) => prefix.startsWith(`[${orgName}]`)), '解散后原 Owner 前缀消失');
  check(!linAfterDissolve.prefixes.some((prefix) => prefix.startsWith(`[${orgName}]`)), '解散后新 Owner 前缀消失');

  const archivedChannel = await prisma.channel.findUnique({ where: { id: defaultChannelId }, select: { archivedAt: true } });
  check(Boolean(archivedChannel?.archivedAt), '解散后组织频道已归档');

  console.log('\nPHASE_B_RESULT=' + JSON.stringify({ ok: true, checks: checks.length }));
}

main()
  .catch((error) => {
    console.error(`\nPHASE_B_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
