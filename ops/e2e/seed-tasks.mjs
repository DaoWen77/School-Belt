/** 造几条委托演示数据（幂等：先清同名） */
const B = 'http://127.0.0.1:3000/api/v1';
const call = async (method, url, token, body) => {
  const response = await fetch(B + url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, data: payload?.data ?? null, error: payload?.error ?? null };
};
const login = async (handle) => {
  const response = await fetch(`${B}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  return (await response.json()).data.accessToken;
};

const creator = await login('creator');
const qiu = await login('qiu');

const t1 = await call('POST', '/belt/tasks', creator, {
  title: '外环测绘原片批量校色',
  description: '约 60 张航拍原片，统一色温并出 JPG，截止周五。',
  priceCents: 3000,
});
const t2 = await call('POST', '/belt/tasks', qiu, {
  title: '环塔导览图排版',
  description: '把中继塔平面图排成一张 A3 导览图，附 10 个标注点。',
  priceCents: 2000,
});
await call('POST', `/belt/tasks/${t2.data?.task?.id}/apply`, creator, { message: '我做过类似的排版，今晚能出稿。' });
await call('POST', `/belt/tasks/${t1.data?.task?.id}/apply`, qiu, { message: '航测原片我可以处理，三天内交。' });
const detail = await call('GET', `/belt/tasks/${t1.data?.task?.id}`, creator);
const applicationId = (detail.data?.applications ?? [])[0]?.id;
const selected = applicationId
  ? await call('POST', `/belt/tasks/${t1.data?.task?.id}/select`, creator, { applicationId })
  : null;
console.log(JSON.stringify({
  t1: t1.status,
  t2: t2.status,
  selected: selected?.status ?? null,
  taskIds: [t1.data?.task?.id, t2.data?.task?.id],
}));
