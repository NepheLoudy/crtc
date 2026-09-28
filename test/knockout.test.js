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

test('录取与角色：ARO 最高/次高为 A/B 组防守方，初始积分 3/2', () => {
  const k = initKnockout(mkSwissDone());
  assert.equal(k.phase, 'assign');
  assert.deepEqual(k.order, ['t8', 't7', 't6', 't5', 't4', 't3', 't2', 't1']);
  assert.equal(k.groups.A.defender, 't8'); // ARO 最高 → A 组防守方
  assert.equal(k.groups.B.defender, 't7');
  assert.equal(k.pts.t8, 3);
  assert.equal(k.pts.t7, 3);
  for (const id of ['t6', 't5', 't4', 't3', 't2', 't1']) assert.equal(k.pts[id], 2);
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

test('平局加赛：直到一方先累计 2 局胜利', () => {
  const s = mkSwissDone();
  const k = initKnockout(s);
  assignAttackers(s, ASSIGN);
  let over = false;
  for (const o of ['attacker', 'draw', 'draw', 'attacker']) {
    over = playGame(s, 'A', o).matchOver;
  }
  assert.equal(over, true);
  assert.equal(k.pts.t6, 3);                 // t6 两次破局得手 +2 → 2+1
  assert.equal(k.pts.t8, 1);                 // t8 被破防 3-2
  assert.equal(k.groups.A.defender, 't6');   // 身份互换
  assert.equal(k.current.A.attacker, 't5');  // t8 回队尾后队首
  assert.equal(k.current.A.games.length, 0); // 已开启下一场
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

  // 决赛：t8 先胜一局，t2 连扳两局（含平局加赛）逆转
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
