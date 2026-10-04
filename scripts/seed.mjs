'use strict';
// 演示数据播种：对运行中的服务端注入一整届赛事（打到淘汰赛阶段）
// 用法：node scripts/seed.mjs [服务地址=http://localhost:8321] [--fresh] [--user admin] --pass <密码>
// 权限模型下需管理员账号执行 reset/建赛。
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8321';
const opt = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : null; };
const AUTH_USER = opt('user') || 'admin';
const AUTH_PASS = opt('pass') || process.env.ADMIN_PASS || '';
let TOKEN = '';

const rand = (() => { let s = 20260929; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
const pick = (a) => a[Math.floor(rand() * a.length)];

async function api(method, url, body) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-session': TOKEN } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`${method} ${url}: ${data.error || res.status}`);
  return data;
}

async function ensureLogin() {
  if (!AUTH_PASS) {
    const probe = await (await fetch(`${BASE}/api/state`)).json();
    // 未启用认证或已有赛事时无需登录也能播种只读部分；写操作失败会明确报错
    if (probe.hasTournament) return;
    throw new Error('需要管理员密码（--pass <密码>）才能在空状态下建赛');
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: AUTH_USER, password: AUTH_PASS }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`管理员登录失败: ${data.error}`);
  TOKEN = data.token;
}

const TEAMS = [
  ['量子波动', 92], ['光棱坦克', 88], ['天启装甲', 85], ['基洛夫空艇', 82],
  ['幻影引擎', 79], ['磁暴线圈', 76], ['犀牛重装', 73], ['履带先锋', 70],
  ['动员兵王', 67], ['侦察哨机', 64], ['矿车疾驰', 61], ['雷达站', 58],
];

async function main() {
  await ensureLogin();
  const cur = await (await fetch(`${BASE}/api/state`)).json();
  if (cur.hasTournament) {
    if (!process.argv.includes('--fresh')) {
      console.log('已有赛事，跳过播种（--fresh 可强制销毁重建）');
      return;
    }
    await api('POST', '/tournament/reset');
  }

  await api('POST', '/tournament', {
    name: '杜博夫系统 · 演示赛',
    totalRounds: 6,
    teams: TEAMS.map(([name, initialScore]) => ({ name, initialScore })),
  });
  console.log('✓ 赛事创建：12 队');

  for (let r = 1; r <= 6; r++) {
    await api('POST', '/swiss/generate');
    let d = await (await fetch(`${BASE}/api/state`)).json();
    const results = d.pending.pairings.map((p) => ({
      board: p.board,
      result: rand() < 0.12 ? 'draw' : rand() < 0.62 ? (p.aroA >= p.aroB ? 'a' : 'b') : (p.aroA >= p.aroB ? 'b' : 'a'),
    }));
    await api('POST', '/swiss/results', { results });
    await api('POST', '/swiss/commit');
    console.log(`✓ 第 ${r} 轮完成`);
  }

  await api('POST', '/knockout/init');
  let d = await (await fetch(`${BASE}/api/state`)).json();
  const assignment = {};
  d.state.knockout.order.slice(2).forEach((id, i) => { assignment[id] = i % 2 === 0 ? 'A' : 'B'; });
  await api('POST', '/knockout/assign', { assignment });
  console.log('✓ 8强录取 + 编组完成（交替分配）');

  // 打若干场：A 组防守方强势，B 组互有攻防
  for (let i = 0; i < 9; i++) {
    d = await (await fetch(`${BASE}/api/state`)).json();
    const k = d.state.knockout;
    if (k.phase !== 'battle') break;
    const g = k.current.A ? (k.current.B ? (i % 2 ? 'B' : 'A') : 'A') : 'B';
    const roll = rand();
    const outcome = g === 'A'
      ? (roll < 0.75 ? 'defender' : roll < 0.9 ? 'attacker' : 'draw')
      : (roll < 0.45 ? 'defender' : roll < 0.85 ? 'attacker' : 'draw');
    await api('POST', '/knockout/game', { group: g, outcome });
  }
  d = await (await fetch(`${BASE}/api/state`)).json();
  const k = d.state.knockout;
  console.log(`✓ 车轮战已推进：阶段=${k.phase}，已赛 ${k.matchCounter} 场，淘汰 ${k.eliminated.length} 队`);
  console.log(`\n打开 ${BASE} 查看效果（#/board 为大屏）`);
}

main().catch((e) => { console.error('播种失败:', e.message); process.exit(1); });
