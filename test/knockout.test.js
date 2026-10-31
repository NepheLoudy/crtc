'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import { newTournament, generateRound, submitResults, commitRound } from '../lib/engine.js';
import {
  initKnockout, assignAttackers, playGame, recordFinalGame, knockoutRanking,
} from '../lib/knockout.js';

// 造一支瑞士轮（1轮）已结束的 8 队赛事：全员平局 → 积分全1，ARO = 对手初始分
// ARO 降序：t8(100) t7(90) t6(80) t5(70) t4(60) t3(50) t2(40) t1(30)
function mkSwissDone() {
  const s = newTournament({
    name: '测试淘汰赛',
    totalRounds: 1,
    teams: [['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60], ['己', 50], ['庚', 40], ['辛', 30]]
      .map(([name, initialScore]) => ({ name, initialScore })),
  });
  generateRound(s);
  const rec = s.swiss.rounds[0];
  submitResults(s, rec.pairings.map((p) => ({ board: p.board, result: 'draw' })));
  commitRound(s);
  return s;
}

const ASSIGN = { t6: 'A', t5: 'A', t4: 'A', t3: 'B', t2: 'B', t1: 'B' };

test('录取与角色：同分全员平局时按 ARO tiebreak 定防守方，初始积分 3/2', () => {
  const k = initKnockout(mkSwissDone());
  assert.equal(k.phase, 'assign');
  assert.deepEqual(k.order, ['t8', 't7', 't6', 't5', 't4', 't3', 't2', 't1']);
  assert.equal(k.groups.A.defender, 't8'); // ARO 最高 → A 组防守方
  assert.equal(k.groups.B.defender, 't7');
  assert.equal(k.pts.t8, 3);
  assert.equal(k.pts.t7, 3);
  for (const id of ['t6', 't5', 't4', 't3', 't2', 't1']) assert.equal(k.pts[id], 2);
});

test('录取与角色修订（10-30 曼波）：积分最高/次高为防守方（同分按 ARO），非 ARO 序', () => {
  const s = newTournament({
    name: '积分优先',
    totalRounds: 1,
    teams: [['甲', 100], ['乙', 90], ['丙', 80], ['丁', 70], ['戊', 60], ['己', 50], ['庚', 40], ['辛', 30]]
      .map(([name, initialScore]) => ({ name, initialScore })),
  });
  // 手工结算一轮：t8 胜 t7、t6 胜 t5、t1 平 t2、t3 平 t4
  // 积分：t6=3 t8=3 t1..t4=1 t5=t7=0；ARO：t2=100 t1=90 t4=80 t3=70 t6=60 t5=50 t8=40 t7=30
  // → 防守方 = t6 与 t8（积分前二，同分按 ARO），ARO 最高的 t2/t1 只是进攻方
  s.swiss.rounds.push({
    round: 1, committed: true,
    pairings: [
      { board: 1, a: 't1', b: 't2', aroA: 100, aroB: 90, result: 'draw', autoLoss: false },
      { board: 2, a: 't3', b: 't4', aroA: 80, aroB: 70, result: 'draw', autoLoss: false },
      { board: 3, a: 't5', b: 't6', aroA: 60, aroB: 50, result: 'b', autoLoss: false },
      { board: 4, a: 't7', b: 't8', aroA: 40, aroB: 30, result: 'b', autoLoss: false },
    ],
  });
  const k = initKnockout(s);
  assert.deepEqual(k.order.slice(0, 2), ['t6', 't8']);
  assert.equal(k.groups.A.defender, 't6');
  assert.equal(k.groups.B.defender, 't8');
  assert.equal(k.pts.t6, 3);
  assert.equal(k.pts.t8, 3);
  assert.equal(k.pts.t2, 2); // ARO 最高者不是防守方
  assert.equal(k.pts.t1, 2);
});

test('志愿分配：队列按 ARO 序编成；防守方连续守住：进攻方 2→1→0 淘汰，防守分 3→3.5→4 封顶', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  assert.equal(k.phase, 'battle');
  assert.equal(k.current.A.attacker, 't6'); // ARO 序在前的先上阵
  assert.equal(k.groups.A.queue.join(','), 't5,t4');

  playGame(s, 'A', 'defender');
  playGame(s, 'A', 'draw');     // 平局不计胜局
  playGame(s, 'A', 'defender'); // 守住（2:0 局分）
  assert.equal(k.pts.t6, 1);
  assert.equal(k.pts.t8, 3.5);
  assert.equal(k.groups.A.queue.join(','), 't4,t6'); // 败方回队尾，新一场已消耗队首 t5
  assert.equal(k.current.A.attacker, 't5');

  playGame(s, 'A', 'defender');
  playGame(s, 'A', 'defender');
  assert.equal(k.pts.t5, 1);    // t5 首败：2 - 1
  assert.equal(k.pts.t8, 4);    // 3.5 + 0.5 触上限
  assert.ok(!k.eliminated.some((e) => e.id === 't5'));
  assert.equal(k.current.A.attacker, 't4');

  // 继续车轮：t4 首败 → t6 二败出局 → t5 二败出局
  playGame(s, 'A', 'defender');
  playGame(s, 'A', 'defender');
  assert.equal(k.pts.t4, 1);
  playGame(s, 'A', 'defender');
  playGame(s, 'A', 'defender');
  assert.equal(k.pts.t6, 0);
  assert.ok(k.eliminated.some((e) => e.id === 't6'), 't6 应先被淘汰');
  assert.equal(k.current.A.attacker, 't5');
  playGame(s, 'A', 'defender');
  playGame(s, 'A', 'defender');
  assert.equal(k.pts.t5, 0);
  assert.ok(k.eliminated.some((e) => e.id === 't5'), 't5 应被淘汰');
});

test('进攻方破防：身份互换、旧防守方回队尾；旧防守方再败即淘汰', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);

  playGame(s, 'B', 'attacker');
  playGame(s, 'B', 'attacker'); // t3 两局破 t7 的防线
  assert.equal(k.groups.B.defender, 't3'); // 身份互换
  assert.equal(k.pts.t3, 3);               // 2 + 1（未触上限）
  assert.equal(k.pts.t7, 1);               // 3 - 2
  assert.equal(k.groups.B.queue.at(-1), 't7'); // 旧防守方回队尾
  assert.equal(k.current.B.attacker, 't2');

  // t2 再破 t3 → t2 接任防守；t1 上阵被守住 → t7 上阵（1分）再败 → 0 分淘汰
  playGame(s, 'B', 'attacker');
  playGame(s, 'B', 'attacker');
  assert.equal(k.groups.B.defender, 't2');
  playGame(s, 'B', 'defender');
  playGame(s, 'B', 'defender'); // 守住 t1
  playGame(s, 'B', 'defender');
  playGame(s, 'B', 'defender'); // 守住 t7 → t7 淘汰
  assert.ok(k.eliminated.some((e) => e.id === 't7'), 't7 应被淘汰');
  assert.equal(k.pts.t7, 0);
});

test('3 局制：平局双负不计胜局，先胜 2 局赢下该场', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  let over = false;
  for (const o of ['attacker', 'draw', 'attacker']) {
    over = playGame(s, 'A', o).matchOver;
  }
  assert.equal(over, true);                  // 2 胜即结束（第 3 局不必打满）
  assert.equal(k.pts.t6, 3);                 // t6 两次破局得手 +2 → 2+1
  assert.equal(k.pts.t8, 1);                 // t8 被破防 3-2
  assert.equal(k.groups.A.defender, 't6');   // 身份互换
  assert.equal(k.current.A.attacker, 't5');  // t8 回队尾后队首
  assert.equal(k.current.A.games.length, 0); // 已开启下一场
});

test('平场：打满 3 局无人 2 胜 → 双方各 -0.5，进攻方回队尾、防守方留任', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  let over = false;
  for (const o of ['defender', 'draw', 'draw']) {
    over = playGame(s, 'A', o).matchOver;
  }
  assert.equal(over, true);                  // 3 局打满 1 胜 0 胜 → 平场
  assert.equal(k.pts.t8, 2.5);               // 3 - 0.5
  assert.equal(k.pts.t6, 1.5);               // 2 - 0.5
  assert.equal(k.matchWins.t8, 0);           // 平场不计胜场
  assert.equal(k.groups.A.defender, 't8');   // 防守方留任
  assert.equal(k.groups.A.queue.join(','), 't4,t6'); // 败方（进攻方）回队尾
  assert.equal(k.current.A.attacker, 't5');  // 下一场已开启
});

test('平场防守方归零：进攻方成为新防守方', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  k.pts.t8 = 0.5;
  k.pts.t6 = 1.5;
  let over = false;
  for (const o of ['draw', 'draw', 'draw']) over = playGame(s, 'A', o).matchOver;
  assert.equal(over, true);
  assert.equal(k.pts.t8, 0);                 // 0.5 - 0.5 归零
  assert.equal(k.pts.t6, 1);                 // 1.5 - 0.5 未归零
  assert.equal(k.groups.A.defender, 't6');   // 进攻方接任防守
  assert.ok(k.eliminated.some((e) => e.id === 't8'));
  assert.ok(!k.eliminated.some((e) => e.id === 't6'));
  assert.equal(k.groups.A.queue.join(','), 't4'); // 接任者不回队尾；下一场已消耗队首 t5
});

test('平场双方归零：顺位进攻方接任；队列空则防守方不淘汰', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  k.pts.t8 = 0.5;
  k.pts.t6 = 0.5;
  for (const o of ['draw', 'draw', 'draw']) playGame(s, 'A', o);
  // 双方归零：t8/t6 均淘汰，顺位进攻方 t5 接任防守
  assert.equal(k.groups.A.defender, 't5');
  assert.ok(k.eliminated.some((e) => e.id === 't8'));
  assert.ok(k.eliminated.some((e) => e.id === 't6'));
  assert.equal(k.groups.A.queue.join(','), '');
  assert.equal(k.current.A.attacker, 't4'); // 顺位进攻方接任后，t4 立即成为其对手

  // 队列空场合：防守方打平归零且无顺位进攻方 → 防守方不淘汰
  k.groups.A.queue = [];
  k.current.A = { defender: 't5', attacker: 't4', games: [] };
  k.pts.t5 = 0.5;
  k.pts.t4 = 0.5;
  for (const o of ['draw', 'draw', 'draw']) playGame(s, 'A', o);
  assert.equal(k.pts.t5, 0);
  assert.ok(!k.eliminated.some((e) => e.id === 't5'), '无顺位进攻方，防守方不淘汰');
  assert.ok(k.eliminated.some((e) => e.id === 't4'));
  assert.equal(k.groups.A.defender, 't5');
  assert.equal(k.current.A, null);
});

test('完整车轮战 → 决赛 BO3 → 冠亚季裁定（胜场 → 积分 → ARO 三级比较）', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);

  // A 组：t8 一路守住，耗光 t6 t5 t4（各两败出局）
  while (k.current.A) {
    playGame(s, 'A', 'defender');
    playGame(s, 'A', 'defender');
  }
  assert.equal(k.pts.t8, 4);
  for (const id of ['t6', 't5', 't4']) {
    assert.ok(k.eliminated.some((e) => e.id === id), `${id} 应被淘汰`);
  }
  assert.equal(k.phase, 'battle'); // B 组还没打完

  // B 组：t3 破 t7 → t2 破 t3 → t2 连守三场清空 t1 t7 t3
  for (const o of ['attacker', 'attacker', 'attacker', 'attacker']) playGame(s, 'B', o);
  assert.equal(k.groups.B.defender, 't2');
  while (k.current.B) {
    playGame(s, 'B', 'defender');
    playGame(s, 'B', 'defender');
  }
  assert.equal(k.phase, 'final');
  assert.deepEqual(k.final.players, ['t8', 't2']);

  // 决赛：t8 先胜一局，t2 连扳两局逆转（决赛平局不计、加赛至分出）
  recordFinalGame(s, 'a');
  assert.equal(recordFinalGame(s, 'draw').done, false);
  recordFinalGame(s, 'b');
  const fin = recordFinalGame(s, 'b');
  assert.equal(fin.done, true);
  assert.equal(k.champion, 't2');
  assert.equal(k.runnerUp, 't8');

  const ranking = knockoutRanking(s);
  assert.equal(ranking.length, 8);
  assert.deepEqual(ranking.map((r) => [r.finalRank, r.teamId]), [
    [1, 't2'], [2, 't8'],
    [3, 't3'],  // 唯一有车轮战胜场（破防1场）→ 季军
    [4, 't7'],  // 其余 0胜0分 → 比瑞士 ARO：90 > 80 > 70 > 60 > 30
    [5, 't6'],
    [6, 't5'],
    [7, 't4'],
    [8, 't1'],
  ]);
});

test('瑞士轮未打完不允许进入淘汰赛；不足 8 队报错', () => {
  const s = newTournament({
    name: '小场',
    totalRounds: 2,
    teams: [['甲', 10], ['乙', 9], ['丙', 8]],
  });
  assert.throws(() => initKnockout(s), /瑞士轮未完成/);
});

// ---------- 退赛与继承 ----------
import { withdrawFromKnockout } from '../lib/knockout.js';

test('进攻方弃赛 → 防守方判胜推进，弃赛者出局不回队列', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  withdrawFromKnockout(s, 't6'); // A 组 current 进攻方
  assert.equal(k.pts.t6, 1);     // 2 - 1（判负扣分）
  assert.equal(k.pts.t8, 3.5);   // 防守 +0.5
  assert.equal(k.matchWins.t8, 1);
  assert.ok(k.eliminated.some((e) => e.id === 't6' && e.reason.includes('弃赛')));
  assert.ok(!k.groups.A.queue.includes('t6'));  // 退赛者不回队列
  assert.equal(k.current.A.attacker, 't5');     // 已开下一场
  assert.throws(() => withdrawFromKnockout(s, 't6'), /已出局/);
});

test('防守方弃赛 → 判负推进：进攻方破防接任防守', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  // B 组：防守 t7 / 队列 [t3,t2,t1]，current = t7 vs t3
  withdrawFromKnockout(s, 't7');
  assert.equal(k.pts.t7, 1);     // 3 - 2（判负）
  assert.equal(k.pts.t3, 3);     // 2 + 1 并接任防守（未触上限）
  assert.equal(k.groups.B.defender, 't3');
  assert.equal(k.matchWins.t3, 1);
  assert.ok(k.eliminated.some((e) => e.id === 't7' && e.reason.includes('弃赛')));
  assert.equal(k.current.B.defender, 't3');  // 已开下一场
  assert.equal(k.current.B.attacker, 't2');
  assert.equal(k.phase, 'battle');
});

test('一组全员退赛 → 另一组打穿队列进决赛，决赛退赛由对手夺冠', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  // B 组逐个退赛（判负推进）：t7→t3 接任；t3→t2 接任；t1(current进攻)退→t2 守住；t2(队列外无场次)退
  withdrawFromKnockout(s, 't7');
  assert.equal(k.groups.B.defender, 't3');
  withdrawFromKnockout(s, 't3');
  assert.equal(k.groups.B.defender, 't2');
  withdrawFromKnockout(s, 't1'); // current 进攻方判负，t2 +0.5
  assert.equal(k.pts.t2, 3.5);
  assert.equal(k.current.B, null); // 队列已空
  withdrawFromKnockout(s, 't2');   // 场上无场次 → 直接标记退赛
  assert.equal(k.groups.B.defender, 't2'); // 角色记录保留
  assert.ok(k.eliminated.some((e) => e.id === 't2'));
  // A 组正常打穿队列
  let guard = 0;
  while (k.current.A && guard++ < 50) { playGame(s, 'A', 'defender'); playGame(s, 'A', 'defender'); }
  assert.equal(k.phase, 'final');
  assert.equal(k.final.players[0], 't8');
  const other = k.final.players[1];
  withdrawFromKnockout(s, other);
  assert.equal(k.phase, 'done');
  assert.equal(k.champion, 't8');
  assert.equal(k.runnerUp, other);
});

test('志愿分配阶段退赛：防守方重排、初始分重置', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assert.equal(k.groups.A.defender, 't8');
  withdrawFromKnockout(s, 't8');
  assert.equal(k.order[0], 't7');
  assert.equal(k.groups.A.defender, 't7');
  assert.equal(k.groups.B.defender, 't6');
  assert.equal(k.phase, 'assign');
  assert.equal(k.pts.t7, 3);
  assert.equal(k.pts.t6, 3);
});

test('决赛选手退赛 → 对手夺冠', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  let guard = 0;
  while (k.phase === 'battle' && guard++ < 300) {
    const g = k.current.A ? 'A' : 'B';
    playGame(s, g, 'defender');
    playGame(s, g, 'defender');
  }
  assert.equal(k.phase, 'final');
  const [a, b] = k.final.players;
  withdrawFromKnockout(s, b);
  assert.equal(k.phase, 'done');
  assert.equal(k.champion, a);
  assert.equal(k.runnerUp, b);
});

test('进攻方在分配阶段全部退赛 → 编组后直接进入决赛', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  for (const id of k.order.slice(2)) withdrawFromKnockout(s, id);
  assert.equal(k.order.length, 2);
  assignAttackers(s, {}); // 无进攻方可编
  assert.equal(k.phase, 'final'); // 不死锁：编组完成即收敛
  assert.deepEqual(k.final.players, ['t8', 't7']);
});
