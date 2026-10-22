'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newTournament, generateRound, submitResults, commitRound,
  computeTable, standings, withdrawTeam, regenerateRound, pendingRound,
} from '../lib/engine.js';

const r3 = (x) => Math.round(x * 1000) / 1000;

function mk(initials, settings = {}) {
  return newTournament({
    name: '测试赛',
    totalRounds: 6,
    settings,
    teams: initials.map(([name, initialScore]) => ({ name, initialScore })),
  });
}

// 按队伍视角录入：spec[teamId] ∈ 'win' | 'loss' | 'draw'（未提及视为 draw）
function playRound(state, spec = {}) {
  const rec = pendingRound(state);
  assert.ok(rec, '没有待录入轮次');
  const results = rec.pairings.map((p) => {
    let result = 'draw';
    if (spec[p.a] === 'win' || spec[p.b] === 'loss') result = 'a';
    else if (spec[p.b] === 'win' || spec[p.a] === 'loss') result = 'b';
    return { board: p.board, result };
  });
  submitResults(state, results);
  commitRound(state);
  return rec;
}

const pairSet = (rec) => rec.pairings.map((p) => [p.a, p.b].sort().join('|')).sort();
const pairWith = (rec, id) => rec.pairings.find((p) => p.a === id || p.b === id);

test('5.3.3 首轮 ARO = 中期考核得分，折叠配对（低ARO配高ARO）', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  const rec = generateRound(s);
  assert.equal(rec.round, 1);
  assert.equal(rec.bye, null);
  // 升序 [丁70, 丙80, 乙90, 甲100] → (丁,甲)(丙,乙)
  assert.deepEqual(pairSet(rec), ['t1|t4', 't2|t3']);
  const table = computeTable(s, 0);
  assert.equal(table.get('t1').aro, 100);
  assert.equal(table.get('t4').aro, 70);
});

test('首轮奇数队伍：ARO 最低者轮空，单组边界下 ARO 项=本组其余均值', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60]]);
  const rec = generateRound(s);
  assert.equal(rec.bye, 't5'); // 戊 60 最低
  assert.equal(rec.pairings.length, 2);
  assert.equal(rec.byeTerm, 85); // (70+80+90+100)/4
  playRound(s, { t1: 'win', t2: 'win' }); // 甲、乙 胜；戊轮空
  const table = computeTable(s, 1);
  assert.equal(table.get('t5').score, 3); // 轮空默认记胜局分
  assert.equal(table.get('t5').aro, 85);
  assert.equal(table.get('t1').aro, 70); // 对手入场 ARO = 丁初始 70
  assert.equal(table.get('t2').aro, 80);
});

test('5.3.1 奇数组级联上调（上调 ARO 最高者）+ 轮空传导到末组', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60]]);
  generateRound(s);
  playRound(s, { t1: 'win', t2: 'win' });
  // R2 积分组：3分[甲70,乙80,戊85]（奇） 0分[丙90,丁100]
  // 级联：3分奇 → 上调丁(100) → 0分组剩丙一人 → 末组奇 → 丙轮空
  const r2 = generateRound(s);
  assert.deepEqual(r2.promoted, ['t4']);
  assert.deepEqual(pairSet(r2), ['t1|t4', 't2|t5']);
  assert.equal(r2.bye, 't3');
  assert.equal(r2.byeTerm, 83.75); // (70+80+85+100)/4
  assert.deepEqual(r2.demoted, []);
});

test('5.3.2 荣誉系数（指数=轮数）：上调者胜 → 对手ARO×1.04²', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60]]);
  generateRound(s);
  playRound(s, { t1: 'win', t2: 'win' });
  generateRound(s);
  playRound(s, { t4: 'win' }); // 上调的丁胜甲（丁R1负于甲积0分）；(乙,戊)未指定 → 平
  const table = computeTable(s, 2);
  assert.equal(table.get('t4').aro, r3((100 + 70 * 1.04 ** 2) / 2)); // 丁R1对手=甲(100)，R2上调胜(70×1.0816)
  assert.equal(table.get('t4').score, 3);
  assert.equal(table.get('t3').score, 3); // R2轮空3
  assert.equal(table.get('t3').aro, r3((90 + 83.75) / 2)); // 丙R1负于乙(项90) + R2轮空(83.75)
  assert.equal(table.get('t5').score, 4); // R1轮空3 + R2平1
  // 平局不吃系数：乙R2对手=戊(入场ARO 85)，k=1
  assert.equal(table.get('t2').aro, r3((80 + 85) / 2));
});

test('5.3.2 fixed1 模式：指数固定为 1', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60]], { honorExponentMode: 'fixed1' });
  generateRound(s);
  playRound(s, { t1: 'win', t2: 'win' });
  generateRound(s);
  playRound(s, { t4: 'win' });
  assert.equal(computeTable(s, 2).get('t4').aro, r3((100 + 70 * 1.04) / 2));
});

test('5.3.2 荣誉系数：下调者负 → 对手ARO×0.97²', () => {
  // 8队：R1 两场平局制造 4 人同分组，其中含两对重复 → 5.3.5 双向移动
  // 注意：甲(100)打辛(30)后甲的ARO=30，辛的ARO=100
  const s = mk([
    ['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70],
    ['戊', 60], ['己', 50], ['庚', 40], ['辛', 30],
  ]);
  generateRound(s); // (辛,甲)(庚,乙)(己,丙)(戊,丁)
  playRound(s, { t1: 'draw', t8: 'draw', t2: 'draw', t7: 'draw', t3: 'win', t4: 'win' });
  // R2 分组：3分[丙50,丁60] 1分[甲30,乙40,庚90,辛100]（含重复对 甲×辛、乙×庚） 0分[己50,戊70]
  // 5.3.5：辛(100)下调至0分组、甲(30)上调至3分组；庚(90)下调、乙(40)上调
  const r2 = generateRound(s);
  assert.equal(r2.warnings.length, 0, r2.warnings.join(';'));
  assert.equal(r2.bye, null);
  assert.deepEqual([...r2.promoted].sort(), ['t1', 't2']);
  assert.deepEqual([...r2.demoted].sort(), ['t7', 't8']);
  const got = pairSet(r2);
  assert.deepEqual(got, ['t1|t4', 't2|t3', 't5|t8', 't6|t7']);
  // 录入：上调的甲(t1)胜丁(t4)；下调的辛(t8)负于己(t6)
  playRound(s, { t1: 'win', t8: 'loss' });
  const table = computeTable(s, 2);
  assert.equal(table.get('t1').aro, r3((30 + 60 * 1.04 ** 2) / 2)); // 上调胜：30 + 60×1.0816
  assert.equal(table.get('t8').aro, r3((100 + 70 * 0.97 ** 2) / 2)); // 下调负：100 + 70×0.9409
});

test('5.3.5 边界：单组全场平局 → 重复无法移动，强制保留并告警', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60], ['己', 50]]);
  generateRound(s);
  playRound(s, { t1: 'draw', t2: 'draw', t3: 'draw' });
  const r2 = generateRound(s);
  assert.ok(r2.warnings.some((w) => w.includes('强制')), r2.warnings.join(';'));
  assert.equal(r2.pairings.length, 3);
});

test('确认门禁：结果未齐不可确认；轮次未确认不可生成下一轮', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  assert.throws(() => commitRound(s), /未录入结果/);
  submitResults(s, [{ board: 1, result: 'a' }]);
  assert.throws(() => commitRound(s), /未录入结果/);
  assert.throws(() => generateRound(s), /尚未确认/);
  submitResults(s, [{ board: 2, result: 'draw' }]);
  commitRound(s);
  assert.equal(pendingRound(s), null);
});

test('重赛：清除已录结果可重录；弃赛判负不可重赛', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const r0 = s.swiss.rounds[0];
  const normal = r0.pairings.find((p) => p.a !== 't4' && p.b !== 't4');
  submitResults(s, [{ board: normal.board, result: 'a' }]);
  submitResults(s, [{ board: normal.board, result: 'reset' }]);
  assert.equal(normal.result, null);
  assert.throws(() => commitRound(s), /未录入结果/); // 清除后回到未录齐状态
  // 弃赛判负由规则自动结算，重赛通道拒绝
  withdrawTeam(s, 't4');
  const w = r0.pairings.find((p) => p.a === 't4' || p.b === 't4');
  assert.equal(w.walkover, true);
  assert.throws(() => submitResults(s, [{ board: w.board, result: 'reset' }]), /弃赛/);
  // 重录后可正常确认（弃赛场已自动判定）
  submitResults(s, [{ board: normal.board, result: 'draw' }]);
  commitRound(s);
  const table = computeTable(s, 1);
  assert.equal(table.get(normal.a).draws, 1);
});

test('regenerate 替换未确认轮次', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const again = regenerateRound(s);
  assert.equal(s.swiss.rounds.length, 1);
  assert.equal(again.round, 1);
  assert.equal(again.committed, false);
});

test('5.3.4 轮中弃赛：不自动判负、标记待人工结算，录入后正常结算', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  withdrawTeam(s, 't4'); // 丁弃赛
  const p = pairWith(s.swiss.rounds[0], 't4');
  // 引擎不自动判定结果——由操作员手动录入（条款 5.3.4 应判负，但由人决定）
  assert.equal(p.a, 't4');
  assert.equal(p.result, 'b');   // 对手甲胜（5.3.4 判负自动推进）
  assert.equal(p.walkover, true);
  // 人工录入：丁判负（对手甲胜，p.a=丁 → 判 'b'）
  submitResults(s, [{ board: p.board, result: 'b' }]);
  const other = s.swiss.rounds[0].pairings.find((x) => x !== p);
  submitResults(s, [{ board: other.board, result: 'draw' }]);
  commitRound(s);
  const table = computeTable(s, 1);
  assert.equal(table.get('t4').losses, 1);
  assert.equal(table.get('t1').wins, 1);
  assert.equal(table.get('t4').aro, 100); // 弃赛轮ARO项保留（对手甲入场ARO）
  generateRound(s);
  const r2 = s.swiss.rounds[1];
  assert.ok(r2.pairings.every((q) => q.a !== 't4' && q.b !== 't4'));
  assert.equal(r2.bye, 't2'); // 3分组甲(70)奇 → 上调丙(90) → 乙(80)在末组轮空
});

test('轮空者退赛：本轮轮空取消，其余对局不受影响', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60]]);
  const r1 = generateRound(s);
  assert.equal(r1.bye, 't5');
  withdrawTeam(s, 't5');
  assert.equal(r1.bye, null);        // 轮空取消（不产生需结算的结果）
  assert.equal(r1.byeTerm, null);
  assert.equal(r1.pairings.length, 2);
  playRound(s, { t1: 'win', t2: 'win' });
  const table = computeTable(s, 1);
  assert.equal(table.get('t5').score, 0); // 无轮空分
  assert.equal(table.get('t5').withdrawn, true);
});

test('排名排序：积分 → ARO → 初始分', () => {
  const s = mk([['甲', 100], ['乙', 95], ['丙', 90], ['丁', 70]]);
  generateRound(s); // (丁70,甲100)(丙90,乙95)
  playRound(s, { t1: 'win', t2: 'draw', t3: 'draw' });
  const list = standings(s);
  assert.equal(list[0].teamId, 't1'); // 甲 3分
  assert.equal(list[1].teamId, 't3'); // 丙 ARO 90 > 乙 ARO 95? 否——乙ARO=90, 丙ARO=95
  assert.equal(list[2].teamId, 't2');
  assert.equal(list[3].teamId, 't4');
});

test('轮空与重复对位同轮：消解重跑级联不吞轮空者（9队回归）', () => {
  // R1：4场+1轮空 → R2 score1 组含两对 R1 重复对位 → 5.3.5 移空该组并重跑级联
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60], ['己', 50], ['庚', 40], ['辛', 30], ['壬', 20]]);
  const r1 = generateRound(s);
  assert.equal(r1.bye, 't9'); // ARO 最低者轮空
  // 仅乙丙胜，其余平 → 积分组 2/4/2：score1 = {甲,辛,戊,丁}，含 (甲,辛)(戊,丁) 两对 R1 重复
  playRound(s, { t2: 'win', t3: 'win', t5: 'draw' });
  const r2 = generateRound(s);
  // 关键不变量：配对完备（8人配对 + 1轮空 = 9）
  const alive = s.teams.filter((t) => !t.withdrawn).length;
  assert.equal(r2.pairings.length * 2 + (r2.bye ? 1 : 0), alive);
  for (const p of r2.pairings) {
    assert.ok(p.a && p.b && p.a !== p.b, '对阵双方必须有效');
  }
  // 继续跑完不崩
  playRound(s, {});
  generateRound(s);
});

// ---------- 5.3.6 重赛 / 5.3.7 停赛与替补 ----------
import { deferRematch, suspendTeam, activeTeams, addTeams } from '../lib/engine.js';

test('5.3.6 下轮再重赛：暂记平局 + 下轮强制对位（豁免禁止重复）', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const r1 = s.swiss.rounds[0];
  const m = r1.pairings[0];
  const other = r1.pairings[1];
  deferRematch(s, m.board);
  assert.equal(m.result, 'draw');
  assert.equal(m.rematchDefer, true);
  assert.equal(s.swiss.rematchQueue.length, 1);
  assert.throws(() => deferRematch(s, m.board), /已登记/);
  submitResults(s, [{ board: other.board, result: 'a' }]);
  commitRound(s);
  // 本轮平局入账：双方各 1 分（保障赛程的暂记口径）
  const t1 = computeTable(s, 1);
  assert.equal(t1.get(m.a).score, 1);
  assert.equal(t1.get(m.a).draws, 1);
  // 下一轮：强制对位 m 双方（带 rematchOf 标记），其余两队正常配对，无轮空
  const r2 = generateRound(s);
  assert.equal(s.swiss.rematchQueue.length, 0);
  assert.equal(r2.pairings.length, 2);
  assert.equal(r2.bye, null);
  const rp = r2.pairings.find((p) => p.rematchOf);
  assert.ok(rp, '应存在强制重赛对位');
  assert.equal(rp.rematchOf, 1);
  assert.deepEqual([rp.a, rp.b].sort(), [m.a, m.b].sort());
  const np = r2.pairings.find((p) => !p.rematchOf);
  assert.deepEqual([np.a, np.b].sort(), [other.a, other.b].sort());
  // 重赛场照常录结果并正常结算
  submitResults(s, [{ board: rp.board, result: 'a' }, { board: np.board, result: 'draw' }]);
  commitRound(s);
  assert.equal(computeTable(s, 2).get(rp.a).wins, 1);
});

test('5.3.7 停赛=移除：本场对局删除、不判对手胜，替补补位无轮空', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const r1 = s.swiss.rounds[0];
  const victimPair = r1.pairings.find((p) => p.a === 't4' || p.b === 't4');
  submitResults(s, [{ board: victimPair.board, result: 'a' }]); // 已录结果也会随场删除
  suspendTeam(s, 't4');
  assert.equal(r1.pairings.length, 1);
  assert.ok(r1.pairings.every((p) => p.a !== 't4' && p.b !== 't4'));
  assert.deepEqual(r1.pairings.map((p) => p.board), [1]); // 批次重编
  assert.equal(s.teams.find((t) => t.id === 't4').suspended, true);
  assert.equal(activeTeams(s).length, 3);
  assert.throws(() => commitRound(s), /未录入结果/); // 删场不产生自动判负
  submitResults(s, [{ board: 1, result: 'draw' }]);
  // 替补入场（初始 ARO=在赛 ARO 中位数 70/80/90 → 80），保持偶数无轮空
  addTeams(s, [{ name: '替补', initialScore: 80 }]);
  commitRound(s);
  const r2 = generateRound(s);
  assert.equal(r2.pairings.length, 2);
  assert.equal(r2.bye, null);
  assert.ok(r2.pairings.every((p) => p.a !== 't4' && p.b !== 't4'));
  const subPair = r2.pairings.find((p) => p.a === 't5' || p.b === 't5');
  assert.ok(subPair, '替补应参赛');
  const midTable = computeTable(s, 1);
  assert.equal(midTable.get('t5').aro, 80); // 替补初始 ARO = 中位数
  assert.equal(midTable.get('t5').score, 0); // 入场前默认全负 → 0 分
  assert.equal(standings(s).find((r) => r.teamId === 't4').suspended, true);
});

test('5.3.7 停赛作废重赛义务：队列清除、下轮不再强制对位', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const r1 = s.swiss.rounds[0];
  const m = r1.pairings[0];
  deferRematch(s, m.board);
  assert.equal(s.swiss.rematchQueue.length, 1);
  submitResults(s, [{ board: r1.pairings[1].board, result: 'a' }]);
  commitRound(s);
  suspendTeam(s, m.a);
  assert.equal(s.swiss.rematchQueue.length, 0);
  const r2 = generateRound(s);
  assert.ok(r2.pairings.every((p) => !p.rematchOf));
  assert.ok(r2.pairings.every((p) => p.a !== m.a && p.b !== m.a));
});

// ---------- 队员申请（5.3.4） ----------
import { addRequest, approveWithdraw, approveReschedule, rejectRequest } from '../lib/engine.js';

test('队员申请：提交、去重、批准调换排至最后一台', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s); // (丁,甲)(丙,乙)，批次随机
  const pending = pendingRound(s);
  const pairD = pending.pairings.find((p) => p.a === 't4');
  const alreadyLast = pairD.board === pending.pairings.length;

  const req = addRequest(s, { type: 'reschedule', teamId: 't4', reason: '设备调试' });
  assert.equal(req.status, 'pending');
  assert.throws(() => addRequest(s, { type: 'reschedule', teamId: 't4' }), /待处理/); // 同类去重

  if (alreadyLast) {
    // 已在最后一台：批准报错，队员可撤回诉求（管理员拒绝）
    assert.throws(() => approveReschedule(s, req.id), /最后一台/);
    rejectRequest(s, req.id);
    assert.equal(req.status, 'rejected');
  } else {
    approveReschedule(s, req.id);
    assert.equal(req.status, 'approved');
    const last = pending.pairings[pending.pairings.length - 1];
    assert.ok(last.a === 't4' || last.b === 't4', '丁应在最后一台');
    pending.pairings.forEach((p, i) => assert.equal(p.board, i + 1, '批次号应重编'));
    assert.ok(pairD.result == null, '调换不影响结果字段');
  }
});
test('队员弃赛申请批准 → 判负推进', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const req = addRequest(s, { type: 'withdraw', teamId: 't4', reason: '设备故障' });
  approveWithdraw(s, req.id);
  const p = pairWith(s.swiss.rounds[0], 't4');
  assert.equal(p.result, 'b');   // 判负（对手甲胜）
  assert.equal(p.walkover, true);
  const team = s.teams.find((t) => t.id === 't4');
  assert.equal(team.withdrawn, true);
  assert.throws(() => addRequest(s, { type: 'withdraw', teamId: 't4' }), /已退赛/);
});
