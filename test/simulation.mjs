'use strict';
// 全流程模拟赛：随机结果跑完 6 轮瑞士轮 + 8 强车轮战，校验不变量
// 用法：node test/simulation.mjs [队伍数=16] [随机种子]
import { newTournament, generateRound, submitResults, commitRound, standings, committedRounds } from '../lib/engine.js';
import { initKnockout, assignAttackers, playGame, recordFinalGame, knockoutRanking } from '../lib/knockout.js';

const N = Number(process.argv[2]) || 16;
let seed = Number(process.argv[3]) || 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const TOTAL_ROUNDS = 6;
const state = newTournament({
  name: `模拟赛-${N}队`,
  totalRounds: TOTAL_ROUNDS,
  teams: Array.from({ length: N }, (_, i) => ({
    name: `队伍${String(i + 1).padStart(2, '0')}`,
    initialScore: Math.round(40 + rand() * 60), // 中期考核 40~100
  })),
});

// ---------- 瑞士轮 ----------
const seen = new Set();
for (let r = 1; r <= TOTAL_ROUNDS; r++) {
  const rec = generateRound(state);
  const warnings = rec.warnings || [];
  for (const p of rec.pairings) {
    const key = [p.a, p.b].sort().join('|');
    if (seen.has(key) && warnings.length === 0) {
      console.error(`✗ 第${r}轮出现未声明的重复对位: ${key}`);
      process.exit(1);
    }
    seen.add(key);
    // 强度接近的对局更容易平局，制造尽可能多的积分层次
    const gap = Math.abs(p.aroA - p.aroB);
    const roll = rand();
    p.result = roll < Math.min(0.18, gap / 400) ? 'draw' : (roll % 1 < 0.5 ? 'a' : (p.aroA >= p.aroB ? 'a' : 'b'));
    if (roll >= 0.18) p.result = rand() < 0.72 ? (p.aroA >= p.aroB ? 'a' : 'b') : (p.aroA >= p.aroB ? 'b' : 'a');
  }
  if (rec.bye) {
    // 轮空无操作
  }
  const missing = rec.pairings.filter((p) => !p.result);
  submitResults(state, rec.pairings.filter((p) => p.result).map((p) => ({ board: p.board, result: p.result })));
  for (const p of missing) { // 补齐随机
    p.result = rand() < 0.5 ? 'a' : 'b';
  }
  submitResults(state, rec.pairings.map((p) => ({ board: p.board, result: p.result })));
  commitRound(state);
  if (warnings.length) console.log(`  第${r}轮警告: ${warnings.join('；')}`);
}

const table = standings(state);
console.log('\n=== 瑞士轮最终排名 ===');
console.log('名次 队伍       积分  ARO     胜/平/负/轮空');
for (const row of table) {
  console.log(
    String(row.rank).padStart(2),
    row.team.name.padEnd(6),
    String(row.score).padStart(4),
    String(row.aro).padStart(7),
    `${row.wins}/${row.draws}/${row.losses}/${row.byes}`,
  );
}
if (committedRounds(state).length !== TOTAL_ROUNDS) { console.error('✗ 轮次数不对'); process.exit(1); }

// ARO 一致性：重算一遍逐项可加
for (const row of table) {
  const sum = row.terms.reduce((s, t) => s + t.k * t.R, 0);
  const expect = row.terms.length ? sum / row.terms.length : row.initialScore;
  if (Math.abs(expect - row.aro) > 0.002) {
    console.error(`✗ ARO 审计不符: ${row.team.name} ${row.aro} vs ${expect}`);
    process.exit(1);
  }
}

// ---------- 淘汰赛 ----------
const k = initKnockout(state);
console.log('\n=== 8强录取（ARO 序）===');
console.log(k.order.map((id, i) => {
  const r = table.find((x) => x.teamId === id);
  return `${i === 0 ? 'A守' : i === 1 ? 'B守' : '攻'} ${r.team.name}(ARO ${r.aro})`;
}).join('\n'));

const assignment = {};
k.order.slice(2).forEach((id, i) => { assignment[id] = i % 2 === 0 ? 'A' : 'B'; });
assignAttackers(state, assignment);

let guard = 0;
while (k.phase === 'battle' && guard++ < 500) {
  for (const g of ['A', 'B']) {
    if (k.phase !== 'battle') break;
    if (!k.current[g]) continue;
    const roll = rand();
    const outcome = roll < 0.5 ? 'defender' : roll < 0.85 ? 'attacker' : 'draw';
    playGame(state, g, outcome);
  }
}
if (k.phase !== 'final') { console.error('✗ 车轮战未收敛到决赛'); process.exit(1); }

guard = 0;
while (k.phase === 'final' && guard++ < 50) recordFinalGame(state, pick(['a', 'b', 'draw']));
if (k.phase !== 'done') { console.error('✗ 决赛未完成'); process.exit(1); }

const ranking = knockoutRanking(state);
console.log('\n=== 最终排名 ===');
const medals = ['冠军', '亚军', '季军', '第4', '第5', '第6', '第7', '第8'];
for (const r of ranking) {
  console.log(`${medals[r.finalRank - 1]}  ${r.name.padEnd(6)} 车轮胜场=${r.matchWins} 积分=${r.pts} 瑞士ARO=${r.swissAro}`);
}
if (ranking.length !== 8) { console.error('✗ 最终排名应为8行'); process.exit(1); }

console.log(`\n✓ 模拟赛通过：${N} 队 / ${TOTAL_ROUNDS} 轮 / ${k.matchCounter} 场车轮战对局`);
