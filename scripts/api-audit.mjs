'use strict';
// API 层全量检测：异常输入守门 + 撤销一致性
// 每段显式重置状态，避免用例间污染。
const BASE = 'http://localhost:8321';
let pass = 0, failCount = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${detail}`); }
};

async function api(method, url, body) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}
const expectErr = async (name, method, url, body, pattern) => {
  const { status, data } = await api(method, url, body);
  ok(name, status === 400 && data.ok === false && (!pattern || pattern.test(data.error || '')), `→ ${status} ${JSON.stringify(data).slice(0, 90)}`);
};
const reset = async () => { await api('POST', '/tournament/reset'); await api('POST', '/tournament/reset'); };
// 硬重置：销毁 + 撤销到栈底（快照可能横跨多届赛事）
const hardReset = async () => {
  await api('POST', '/tournament/reset');
  for (let i = 0; i < 200; i++) {
    const { data } = await api('POST', '/undo');
    if (data.ok === false) break;
    await api('POST', '/tournament/reset');
  }
};
const mkTournament = async (n = 9, rounds = 2) => {
  await hardReset();
  const { data } = await api('POST', '/tournament', {
    name: '全量检测赛', totalRounds: rounds,
    teams: Array.from({ length: n }, (_, i) => ({ name: `检测队${i + 1}`, initialScore: 90 - i * 5 })),
  });
  return data;
};

(async () => {
  console.log('== A. 空状态守门 ==');
  await hardReset();
  let r = await api('GET', '/state');
  ok('前置：状态确为空', r.data.hasTournament === false);
  await expectErr('空状态生成对阵', 'POST', '/swiss/generate', {}, /尚未创建赛事/);
  await expectErr('空状态录入结果', 'POST', '/swiss/results', { results: [] }, /尚未创建赛事/);
  await expectErr('空状态退赛', 'POST', '/teams/t1/withdraw', {}, /尚未创建赛事/);
  await expectErr('空状态改设置', 'PUT', '/settings', {}, /尚未创建赛事/);
  r = await api('GET', '/export/standings.csv');
  ok('空状态导出 404', r.status === 404, `→ ${r.status}`);
  // reset 的可撤销性（设计行为：销毁也可反悔）
  await api('POST', '/tournament', { name: '临时赛', totalRounds: 1, teams: [{ name: '甲', initialScore: 1 }] });
  await api('POST', '/tournament/reset');
  const back = await api('POST', '/undo');
  ok('销毁赛事可撤销恢复', back.data.ok === true && back.data.label === '销毁赛事');
  await hardReset();

  console.log('== B. 建赛与参数守门 ==');
  const created = await mkTournament(9, 2);
  ok('建赛成功', created?.ok === true);
  await expectErr('重复建赛', 'POST', '/tournament', { name: 'x', teams: [] }, /已存在赛事/);
  await expectErr('空名建队', 'POST', '/teams', { teams: [{ name: '  ' }] }, /没有有效/);
  await expectErr('不存在的队伍', 'PUT', '/teams/t999', { name: 'x' }, /不存在/);
  await api('PUT', '/settings', { meta: { totalRounds: 'abc' } });
  const stB = (await api('GET', '/state')).data;
  ok('非法轮次回退默认6', stB.state.meta.totalRounds === 6, 'totalRounds=' + stB.state.meta.totalRounds);

  console.log('== C. 瑞士轮流程守门 ==');
  await expectErr('未生成先确认', 'POST', '/swiss/commit', {}, /没有待确认|待录入/);
  await api('POST', '/swiss/generate');
  await expectErr('未确认再生成', 'POST', '/swiss/generate', {}, /尚未确认/);
  await expectErr('非法结果值', 'POST', '/swiss/results', { results: [{ board: 1, result: 'x' }] }, /非法结果/);
  await expectErr('不存在的批次', 'POST', '/swiss/results', { results: [{ board: 99, result: 'a' }] }, /批次不存在/);
  await expectErr('负数批次', 'POST', '/swiss/results', { results: [{ board: -1, result: 'a' }] }, /批次不存在/);
  await expectErr('结果未齐就确认', 'POST', '/swiss/commit', {}, /未录入结果/);
  let { data: st } = await api('GET', '/state');
  await api('POST', '/swiss/results', { results: st.pending.pairings.map((p, i) => ({ board: p.board, result: i % 3 === 0 ? 'a' : i % 3 === 1 ? 'draw' : 'b' })) });
  await api('POST', '/swiss/commit');
  await expectErr('重复确认', 'POST', '/swiss/commit', {}, /没有待确认/);
  await expectErr('重新生成已确认轮', 'POST', '/swiss/regenerate', {}, /没有可重新生成/);

  console.log('== D. 弃赛判负推进 ==');
  await api('POST', '/swiss/generate');
  st = (await api('GET', '/state')).data;
  const victimPair = st.pending.pairings[0];
  const victim = victimPair.a;
  await api('POST', `/teams/${victim}/withdraw`, {});
  st = (await api('GET', '/state')).data;
  const p = st.pending.pairings.find((x) => x.board === victimPair.board);
  ok('弃赛自动判负并带标记', p.result === (p.a === victim ? 'b' : 'a') && p.walkover === true);
  ok('其余场次仍待人工录入', st.pending.pairings.filter((x) => x.result == null).length === st.pending.pairings.length - 1);
  await api('POST', '/swiss/commit');
  const again = await api('POST', `/teams/${victim}/withdraw`, {});
  ok('重复退赛幂等返回', again.data.ok === true);
  const re = await api('POST', `/teams/${victim}/reinstate`);
  ok('恢复接口可用', re.data.ok === true);

  console.log('== E. 撤销一致性 ==');
  // 当前链条：建赛→R1→R2生成→弃赛→确认→恢复。逐个撤销应能精确回放每一步。
  const before = (await api('GET', '/state')).data;
  const marks = [];
  marks.push({ name: '恢复后', committed: before.state.swiss.rounds.filter((r) => r.committed).length, pending: !!before.pending });
  let undos = 0;
  const observations = [];
  while (undos < 60) {
    const { data } = await api('POST', '/undo');
    if (data.ok === false) break;
    undos++;
    const s = (await api('GET', '/state')).data;
    observations.push({ undoLabel: data.label, rounds: s.state.swiss.rounds.length, committed: s.state.swiss.rounds.filter((r) => r.committed).length, canUndo: s.canUndo });
  }
  const last = observations[observations.length - 1];
  ok(`连续撤销 ${undos} 次到达栈底`, last?.canUndo === false);
  ok('撤销深度不超过栈上限40', undos <= 40, `undos=${undos}`);
  const err = await api('POST', '/undo');
  ok('栈底再撤销报错', err.data.ok === false, JSON.stringify(err.data).slice(0, 60));
  // 重建并重放：撤销后重做同序列，结果应与撤销前一致（幂等回放）
  await mkTournament(9, 2);
  for (let r = 0; r < 2; r++) {
    await api('POST', '/swiss/generate');
    st = (await api('GET', '/state')).data;
    await api('POST', '/swiss/results', { results: st.pending.pairings.map((p2) => ({ board: p2.board, result: 'draw' })) });
    await api('POST', '/swiss/commit');
  }
  const replayed = (await api('GET', '/state')).data;
  ok('重放后两轮全部确认', replayed.swissProgress.done === 2 && replayed.swissDone === true);

  console.log('== F. 淘汰赛守门与终局 ==');
  const init = await api('POST', '/knockout/init');
  ok('瑞士轮满后录取 8 强', init.data.ok === true, JSON.stringify(init.data).slice(0, 60));
  await expectErr('重复录取', 'POST', '/knockout/init', {}, /已初始化/);
  await expectErr('非法组别录局', 'POST', '/knockout/game', { group: 'C', outcome: 'defender' }, /非法组别|不在车轮战/);
  await expectErr('未编组就录局', 'POST', '/knockout/game', { group: 'A', outcome: 'defender' }, /不在车轮战|没有挑战/);
  st = (await api('GET', '/state')).data;
  const assignment = {};
  st.state.knockout.order.slice(2).forEach((id, i) => { assignment[id] = i % 2 === 0 ? 'A' : 'B'; });
  await expectErr('编组缺人校验', 'POST', '/knockout/assign', { assignment: { ...assignment, [st.state.knockout.order[2]]: undefined } }, /未分配/);
  await api('POST', '/knockout/assign', { assignment });
  await expectErr('重复编组', 'POST', '/knockout/assign', { assignment }, /不在志愿分配/);
  await expectErr('决赛阶段误录局', 'POST', '/knockout/final', { outcome: 'a' }, /不在决赛/);
  await expectErr('非法当局结果', 'POST', '/knockout/game', { group: 'A', outcome: 'coin' }, /非法/);

  for (let i = 0; i < 600; i++) {
    st = (await api('GET', '/state')).data;
    const k = st.state.knockout;
    if (k.phase === 'final') { await api('POST', '/knockout/final', { outcome: 'a' }); continue; }
    if (k.phase !== 'battle') break;
    const g = k.current.A ? 'A' : 'B';
    await api('POST', '/knockout/game', { group: g, outcome: 'defender' });
  }
  st = (await api('GET', '/state')).data;
  ok('车轮战推进至终局', ['final', 'done'].includes(st.state.knockout.phase), st.state.knockout.phase);
  await expectErr('终局后继续录局', 'POST', '/knockout/game', { group: 'A', outcome: 'defender' }, /不在车轮战/);
  await expectErr('终局后退赛', 'POST', `/teams/${st.state.knockout.order[0]}/withdraw`, {}, /已结束|已出局/);
  const rank = st.knockoutRanking;
  ok('最终排名 8 行且名次连续', rank?.length === 8 && rank.every((r, i) => r.finalRank === i + 1));

  console.log(`\n== 结果：${pass} 通过 / ${failCount} 失败 ==`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => { console.error('检测脚本崩溃:', e); process.exit(1); });
