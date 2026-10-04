'use strict';
// 全量检测：多规模多种子模拟赛 + 不变量断言
// 用法：node test/simulation.mjs [队伍数] [种子] [平局偏好0~1]
import { newTournament, generateRound, submitResults, commitRound, standings, committedRounds, computeTable, withdrawTeam } from '../lib/engine.js';
import { initKnockout, assignAttackers, playGame, recordFinalGame, knockoutRanking } from '../lib/knockout.js';

const N = Number(process.argv[2]) || 16;
let seed = Number(process.argv[3]) || 42;
const DRAW_BIAS = Number(process.argv[4]) || 0.15; // 平局率偏好：高值制造零碎积分组结构
const TOTAL_ROUNDS = 6;

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const ids = new Set();

const state = newTournament({
  name: `全量检测-${N}队`,
  totalRounds: TOTAL_ROUNDS,
  teams: Array.from({ length: N }, (_, i) => ({
    name: `队伍${String(i + 1).padStart(2, '0')}`,
    initialScore: Math.round(40 + rand() * 60),
  })),
});
state.teams.forEach((t) => ids.add(t.id));

// ---------- 瑞士轮 ----------
for (let r = 1; r <= TOTAL_ROUNDS; r++) {
  const rec = generateRound(state);

  // 不变量1：对阵双方均为有效在列队伍（防 undefined 混入）
  for (const p of rec.pairings) {
    if (!ids.has(p.a) || !ids.has(p.b)) fail(`第${r}轮出现非法队伍引用: ${p.a} vs ${p.b}`);
    if (p.a === p.b) fail(`第${r}轮自我对位: ${p.a}`);
    if (p.aroA == null || p.aroB == null || Number.isNaN(p.aroA + p.aroB)) fail(`第${r}轮 ARO 非法`);
  }
  // 不变量2：偶数完备性（配对数×2 + 轮空 = 在赛人数）
  const aliveCount = state.teams.filter((t) => !t.withdrawn).length;
  if (rec.pairings.length * 2 + (rec.bye ? 1 : 0) !== aliveCount) {
    fail(`第${r}轮配对不完备: ${rec.pairings.length}×2+${rec.bye ? 1 : 0} ≠ ${aliveCount}`);
  }
  // 不变量3：无未声明重复对位
  const past = new Set();
  for (const done of committedRounds(state)) for (const p of done.pairings) past.add([p.a, p.b].sort().join('|'));
  for (const p of rec.pairings) {
    if (past.has([p.a, p.b].sort().join('|')) && !(rec.warnings || []).length) {
      fail(`第${r}轮未声明重复对位: ${p.a}|${p.b}`);
    }
  }

  // 随机结果（平局率可调，制造零碎分组）；随机 3% 概率轮中弃赛（判负推进）
  const results = rec.pairings.map((p) => ({
    board: p.board,
    result: rand() < DRAW_BIAS ? 'draw' : (rand() < 0.62 ? (p.aroA >= p.aroB ? 'a' : 'b') : (p.aroA >= p.aroB ? 'b' : 'a')),
  }));
  submitResults(state, results);
  if (rand() < 0.04) {
    const victims = state.teams.filter((t) => !t.withdrawn && t.id !== rec.bye);
    if (victims.length > 9) { // 保底留足 8 强
      withdrawTeam(state, pick(victims).id);
      console.log(`  第${r}轮有队伍弃赛（判负推进）`);
    }
  }
  commitRound(state);
  if (rec.warnings?.length) console.log(`  第${r}轮警告: ${rec.warnings[0]}`);
}

// 不变量4：ARO 可由 terms 精确回放
const table = standings(state);
for (const row of table) {
  const sum = row.terms.reduce((s, t) => s + t.k * t.R, 0);
  const expect = row.terms.length ? sum / row.terms.length : row.initialScore;
  if (Math.abs(expect - row.aro) > 0.0015) fail(`ARO 审计不符: ${row.team.name} ${row.aro} vs ${expect}`);
}
// 不变量5：积分守恒（每场非平局产 3 分、平局各 1 分）
const committed = committedRounds(state);
const totalScore = table.reduce((s, r) => s + r.score, 0);
const decided = committed.reduce((s, r) => s + r.pairings.filter((p) => p.result !== 'draw').length, 0);
const drawn = committed.reduce((s, r) => s + r.pairings.filter((p) => p.result === 'draw').length, 0);
const byes = committed.reduce((s, r) => s + (r.bye ? 1 : 0), 0);
const expectTotal = decided * (state.settings.winPoints + state.settings.lossPoints) + drawn * 2 * state.settings.drawPoints + byes * state.settings.byePoints;
if (Math.abs(totalScore - expectTotal) > 0.001) fail(`积分守恒破坏: ${totalScore} ≠ ${expectTotal}`);

console.log('\n=== 瑞士轮最终排名（前8）===');
for (const row of table.slice(0, 8)) {
  console.log(String(row.rank).padStart(2), row.team.name.padEnd(6), String(row.score).padStart(4), '分 ARO', String(row.aro).padStart(7), `${row.wins}-${row.draws}-${row.losses}${row.byes ? `+${row.byes}轮空` : ''}`);
}

// ---------- 淘汰赛 ----------
const k = initKnockout(state);
const assignment = {};
k.order.slice(2).forEach((id, i) => { assignment[id] = i % 2 === 0 ? 'A' : 'B'; });
assignAttackers(state, assignment);

let guard = 0;
while (k.phase === 'battle' && guard++ < 2000) {
  const g = k.current.A ? 'A' : 'B';
  if (!k.current[g]) break;
  // 1% 概率场上选手退赛（判负推进路径）
  if (rand() < 0.01) {
    const cur = k.current[g];
    withdrawTeam(state, rand() < 0.5 ? cur.defender : cur.attacker);
    continue;
  }
  const roll = rand();
  playGame(state, g, roll < 0.5 ? 'defender' : roll < 0.85 ? 'attacker' : 'draw');
}
if (k.phase !== 'final') fail(`车轮战未收敛: phase=${k.phase}`);
guard = 0;
while (k.phase === 'final' && guard++ < 100) recordFinalGame(state, pick(['a', 'b', 'draw']));
if (k.phase !== 'done') fail('决赛未完成');

// 不变量6：最终排名完整且排名对象唯一
const ranking = knockoutRanking(state);
if (ranking.length !== 8) fail(`最终排名应 8 行，实际 ${ranking.length}`);
const uniq = new Set(ranking.map((r) => r.teamId));
if (uniq.size !== 8) fail('最终排名存在重复队伍');
for (let i = 0; i < 8; i++) if (ranking[i].finalRank !== i + 1) fail(`名次断裂 @${i + 1}`);

console.log('=== 最终排名 ===');
console.log(ranking.map((r) => `${r.finalRank}.${r.name}`).join(' '));
console.log(`\n✓ 通过：${N}队 / ${TOTAL_ROUNDS}轮 / 弃赛${state.teams.filter(t => t.withdrawn).length}起 / 车轮战${k.matchCounter}场`);
