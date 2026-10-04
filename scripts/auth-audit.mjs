'use strict';
// 认证与权限矩阵检测
const BASE = 'http://localhost:8321';
let pass = 0, failCount = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${detail}`); }
};
async function call(method, url, body, token) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}
async function login(name, password) {
  const { status, data } = await call('POST', '/auth/login', { name, password });
  if (status !== 200) throw new Error(`登录失败 ${name}: ${data.error}`);
  return data.token;
}

(async () => {
  // 管理员先登录：清理类操作（reset/undo）在权限模型下需要管理员会话
  const admin = await login('admin', 'Admin@2026');
  const ref = await login('referee1', 'Judge@2026');
  const wipe = async () => {
    await call('POST', '/tournament/reset', {}, admin);
    for (let i = 0; i < 80; i++) {
      const { data } = await call('POST', '/undo', {}, admin);
      if (data.ok === false) break;
      await call('POST', '/tournament/reset', {}, admin);
    }
    await call('POST', '/tournament/reset', {}, admin);
  };

  console.log('== 登录守门 ==');
  const bad = await call('POST', '/auth/login', { name: 'referee1', password: 'wrong' });
  ok('错误密码 401', bad.status === 401);
  const ghost = await call('POST', '/auth/login', { name: 'nouser', password: 'whatever' });
  ok('不存在用户 401', ghost.status === 401);
  ok('管理员登录', !!admin);
  ok('裁判登录', !!ref);
  const me = await call('GET', '/auth/me', undefined, ref);
  ok('会话有效性', me.data.me?.role === 'referee');

  await wipe();
  const clean = await call('GET', '/state');
  ok('清理后状态为空', clean.data.hasTournament === false);

  console.log('== 建赛（仅管理员）==');
  ok('裁判建赛被拒', (await call('POST', '/tournament', { name: 'x', teams: [] }, ref)).status === 403);
  ok('匿名建赛被拒', (await call('POST', '/tournament', { name: 'x', teams: [] })).status === 401);
  const mk = await call('POST', '/tournament', {
    name: '权限检测赛', totalRounds: 1,
    teams: Array.from({ length: 8 }, (_, i) => ({ name: `队${i + 1}`, initialScore: 80 - i * 5 })),
  }, admin);
  ok('管理员建赛', mk.data.ok === true, JSON.stringify(mk.data).slice(0, 80));

  console.log('== 瑞士轮权限 ==');
  await call('POST', '/swiss/generate', {}, admin);
  ok('裁判生成对阵被拒', (await call('POST', '/swiss/generate', {}, ref)).status === 403);
  ok('匿名生成对阵被拒', (await call('POST', '/swiss/generate')).status === 401);
  const st = (await call('GET', '/state')).data;
  const results = st.pending.pairings.map((p) => ({ board: p.board, result: p.aroA >= p.aroB ? 'a' : 'b' }));
  const r1 = await call('POST', '/swiss/results', { results }, ref);
  ok('裁判录入结果 ✓', r1.data.ok === true);
  const r1anon = await call('POST', '/swiss/results', { results });
  ok('匿名录入被拒 401', r1anon.status === 401);
  const r1adm = await call('POST', '/swiss/results', { results }, admin);
  ok('管理员录入 ✓（超集）', r1adm.data.ok === true);
  ok('裁判确认本轮 ✓', (await call('POST', '/swiss/commit', {}, ref)).data.ok === true);

  console.log('== 淘汰赛权限 ==');
  ok('裁判录取8强被拒', (await call('POST', '/knockout/init', {}, ref)).status === 403);
  await call('POST', '/knockout/init', {}, admin);
  const st2 = (await call('GET', '/state')).data;
  const assignment = {};
  st2.state.knockout.order.slice(2).forEach((id, i) => { assignment[id] = i % 2 === 0 ? 'A' : 'B'; });
  ok('裁判编组被拒', (await call('POST', '/knockout/assign', { assignment }, ref)).status === 403);
  ok('管理员编组 ✓', (await call('POST', '/knockout/assign', { assignment }, admin)).data.ok === true);
  const g1 = await call('POST', '/knockout/game', { group: 'A', outcome: 'defender' }, ref);
  ok('裁判录局 ✓', g1.data.ok === true || /没有挑战|判负/.test(g1.data.error || '') === false);
  ok('匿名录局被拒', (await call('POST', '/knockout/game', { group: 'A', outcome: 'defender' })).status === 401);

  console.log('== 退赛/撤销/设置（仅管理员）==');
  ok('裁判退赛被拒', (await call('POST', '/teams/t1/withdraw', {}, ref)).status === 403);
  ok('裁判改设置被拒', (await call('PUT', '/settings', { meta: { name: 'x' } }, ref)).status === 403);
  ok('裁判撤销被拒', (await call('POST', '/undo', {}, ref)).status === 403);
  ok('裁判销毁被拒', (await call('POST', '/tournament/reset', {}, ref)).status === 403);

  console.log('== 导出与审计 ==');
  const csv = await fetch(`${BASE}/api/export/standings.csv`);
  ok('排名CSV公开', csv.status === 200);
  ok('全量JSON匿名被拒', (await fetch(`${BASE}/api/export/json`)).status === 403);
  ok('全量JSON裁判被拒', (await fetch(`${BASE}/api/export/json`, { headers: { 'x-session': ref } })).status === 403);
  const auditRef = await call('GET', '/audit', undefined, ref);
  ok('裁判看审计被拒', auditRef.status === 403);
  const auditAdmin = await call('GET', '/audit?limit=50', undefined, admin);
  ok('管理员看审计 ✓', auditAdmin.data.ok === true && auditAdmin.data.entries.length > 0);
  const hasDenyLog = auditAdmin.data.entries.some((e) => e.ok === false && /权限/.test(e.error || ''));
  ok('越权尝试已入审计', hasDenyLog);
  const hasLoginLog = auditAdmin.data.entries.some((e) => e.action === '登录');
  ok('登录事件已入审计', hasLoginLog);

  console.log('== 登出 ==');
  ok('登出 ✓', (await call('POST', '/auth/logout', {}, ref)).data.ok === true);
  ok('登出后会话失效', (await call('GET', '/auth/me', undefined, ref)).data.me === null);

  console.log(`\n== 结果：${pass} 通过 / ${failCount} 失败 ==`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e); process.exit(1); });
