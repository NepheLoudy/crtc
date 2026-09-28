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

test('regenerate 替换未确认轮次', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  const again = regenerateRound(s);
  assert.equal(s.swiss.rounds.length, 1);
  assert.equal(again.round, 1);
  assert.equal(again.committed, false);
});

test('5.3.4 轮中弃赛：自动判负、保留该轮ARO项、后续不再参与', () => {
  const s = mk([['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70]]);
  generateRound(s);
  withdrawTeam(s, 't4');
  const p = pairWith(s.swiss.rounds[0], 't4');
  // 丁 ARO 70 最低 → 是该场 p.a；自动判负即对手(b)胜
  assert.equal(p.a, 't4');
  assert.equal(p.result, 'b');
  assert.equal(p.autoLoss, true);
  // 另一场录入后确认
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
