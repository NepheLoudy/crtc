'use strict';
// ============================================================
// 8强车轮战淘汰赛引擎（5.2 条款）
//
//  - 录取：瑞士轮积分降序 → ARO 降序，取前 8。
//  - 角色：ARO 最高/次高 → A/B 组防守方；其余 6 队按 ARO 序志愿选组。
//  - 初始积分：防守方 3（上限 4），进攻方 2。
//  - 每场比赛 BO3（先胜 2 局；平局加赛直至分出）。
//  - 防守方胜：进攻方 -1，防守方 +0.5（受上限约束）；
//    进攻方胜：防守方 -2，进攻方 +1，双方身份互换。
//  - 每场败方重排进攻队列队尾；积分 ≤ 0 淘汰；场上仅剩 2 队 → 决赛。
//  - 季军裁定：车轮战胜场总数 → 总积分 → 瑞士轮 ARO。
//
// 实现口径（规则未尽的两个边界，均可通过设置调整语义）：
//  - 「防守方积分上限 4」在队伍成为防守方的瞬间及防守得分时生效；
//  - 淘汰判定在每场比赛结算后统一执行。
// ============================================================

import { standings, committedRounds, teamById } from './engine.js';

const now = () => new Date().toISOString();

function log(k, msg, extra = {}) {
  k.log.push({ ts: now(), msg, ...extra });
}

export function initKnockout(state) {
  if (state.knockout) throw new Error('淘汰赛已初始化');
  const done = committedRounds(state).length;
  if (done < state.meta.totalRounds) {
    throw new Error(`瑞士轮未完成（${done}/${state.meta.totalRounds}），无法进入淘汰赛`);
  }
  const table = standings(state).filter((r) => !r.withdrawn);
  if (table.length < 8) throw new Error(`可参赛队伍不足 8 支（当前 ${table.length}），无法录取 8 强`);

  const qualified = table.slice(0, 8);
  const order = [...qualified]
    .sort((a, b) => b.aro - a.aro || b.score - a.score) // ARO 降序（同 ARO 按积分）
    .map((r) => r.teamId);

  const s = state.settings;
  const pts = {};
  const matchWins = {};
  order.forEach((id, i) => {
    pts[id] = i < 2 ? s.defenderStart : s.attackerStart;
    matchWins[id] = 0;
  });

  state.knockout = {
    phase: 'assign', // assign → battle → final → done
    order, // [0] → A组防守方，[1] → B组防守方，其余为进攻方（志愿排序）
    groups: {
      A: { defender: order[0], queue: [] },
      B: { defender: order[1], queue: [] },
    },
    pts,
    matchWins,
    current: { A: null, B: null }, // 进行中的一场：{ defender, attacker, games[] }
    eliminated: [], // { id, order, reason }
    log: [],
    final: null, // { players: [a, b], games: [] }
    champion: null,
    runnerUp: null,
    matchCounter: 0,
  };
  log(state.knockout, '8强录取完成，进入进攻组别志愿分配');
  return state.knockout;
}

export function assignAttackers(state, assignment) {
  const k = state.knockout;
  if (!k || k.phase !== 'assign') throw new Error('当前不在志愿分配阶段');
  const attackers = k.order.slice(2);
  for (const id of attackers) {
    if (assignment[id] !== 'A' && assignment[id] !== 'B') {
      throw new Error(`队伍 ${teamById(state, id)?.name || id} 未分配进攻组别`);
    }
  }
  k.groups.A.queue = attackers.filter((id) => assignment[id] === 'A');
  k.groups.B.queue = attackers.filter((id) => assignment[id] === 'B');
  for (const g of ['A', 'B']) {
    const { queue, defender } = k.groups[g];
    k.current[g] = queue.length
      ? { defender, attacker: queue.shift(), games: [] }
      : null;
  }
  k.phase = 'battle';
  log(k, '进攻队列编组完成，车轮战开始', {
    a: ['def', k.groups.A.defender, ...k.groups.A.queue],
    b: ['def', k.groups.B.defender, ...k.groups.B.queue],
  });
  return k;
}

function eliminatedIds(k) {
  return new Set(k.eliminated.map((e) => e.id));
}

function field(k) {
  const out = eliminatedIds(k);
  return k.order.filter((id) => !out.has(id));
}

function eliminate(state, k, id, reason) {
  if (eliminatedIds(k).has(id)) return;
  k.eliminated.push({ id, order: k.eliminated.length + 1, reason });
  log(k, `${name(state, id)} 被淘汰（${reason}）`, { eliminated: id });
}

export function playGame(state, group, outcome) {
  const k = state.knockout;
  if (!k || k.phase !== 'battle') throw new Error('当前不在车轮战阶段');
  if (group !== 'A' && group !== 'B') throw new Error(`非法组别: ${group}`);
  const cur = k.current[group];
  if (!cur) throw new Error(`${group} 组当前没有挑战场次（进攻队列已空）`);
  if (!['defender', 'attacker', 'draw'].includes(outcome)) throw new Error(`非法当局结果: ${outcome}`);

  cur.games.push(outcome);
  const defWins = cur.games.filter((x) => x === 'defender').length;
  const atkWins = cur.games.filter((x) => x === 'attacker').length;
  const s = state.settings;

  if (defWins < 2 && atkWins < 2) return { matchOver: false, games: cur.games };

  // —— 一场比赛结束，结算积分 ——
  k.matchCounter += 1;
  const no = k.matchCounter;
  const { defender, attacker } = cur;

  if (defWins >= 2) {
    k.pts[attacker] -= 1;
    k.pts[defender] = Math.min(k.pts[defender] + 0.5, s.defenderCap);
    k.matchWins[defender] += 1;
    log(k, `第${no}场（${group}组）防守方守住：${name(state, defender)} +0.5 / ${name(state, attacker)} -1`, {
      match: no, group, defender, attacker, winner: defender, games: [...cur.games],
    });
    if (k.pts[attacker] <= 0) eliminate(state, k, attacker, `进攻失败，积分 ${fmt(k.pts[attacker])} ≤ 0`);
    else if (!cur.attackerWithdrawn) k.groups[group].queue.push(attacker); // 败方回队列队尾（弃赛者除外）
    else log(k, `${name(state, attacker)} 已弃赛，不回队列`);
  } else {
    k.pts[defender] -= 2;
    k.pts[attacker] += 1;
    k.matchWins[attacker] += 1;
    // 身份互换：进攻方成为新防守方（防守上限即时生效）
    k.groups[group].defender = attacker;
    k.pts[attacker] = Math.min(k.pts[attacker], s.defenderCap);
    log(k, `第${no}场（${group}组）防线告破：${name(state, attacker)} +1 接任防守 / ${name(state, defender)} -2`, {
      match: no, group, defender, attacker, winner: attacker, games: [...cur.games], swap: true,
    });
    if (k.pts[defender] <= 0) eliminate(state, k, defender, `防守被击破，积分 ${fmt(k.pts[defender])} ≤ 0`);
    else k.groups[group].queue.push(defender);
  }

  // 统一淘汰扫描（双保险）后开启下一场
  for (const id of k.order) {
    if (k.pts[id] <= 0) eliminate(state, k, id, `积分 ${fmt(k.pts[id])} ≤ 0`);
  }
  const { queue, defender: newDef } = k.groups[group];
  k.current[group] = queue.length
    ? { defender: newDef, attacker: queue.shift(), games: [] }
    : null;

  checkFieldEnd(state, k);
  return { matchOver: true, games: cur.games, alive: field(k).length };
}

// 场上人数收敛检查：剩 1 人直接夺冠（另一组全空时），剩 2 人进入决赛
function checkFieldEnd(state, k) {
  const alive = field(k);
  if (k.phase !== 'battle') return alive;
  if (alive.length === 1) {
    k.phase = 'done';
    k.champion = alive[0];
    k.runnerUp = null;
    log(k, `场上仅剩 ${name(state, alive[0])} 一支防守方，直接夺冠`);
  } else if (alive.length === 2) {
    k.phase = 'final';
    k.final = { players: alive, games: [] };
    k.current = { A: null, B: null };
    log(k, `场上仅剩两支防守方：${name(state, alive[0])} vs ${name(state, alive[1])}，进入决赛`);
  }
  return alive;
}

// ============================================================
// 退赛与继承（淘汰赛）
//  - 引擎不自动判定任何对局结果；当前场进攻方退赛只标记「待人工结算」，
//    由操作员逐局录入剩余局分，或通过 settleWalkover 手动补判防守方胜。
//  - 防守方退赛 → 继承算法：该场取消（已录局分作废不结算），
//    进攻队列队首接任防守方（积分保留自身值，按防守上限截断），
//    并开启下一场；队列空则该组防守空缺。
// ============================================================
export function withdrawFromKnockout(state, teamId) {
  const k = state.knockout;
  if (!k) throw new Error('尚未进入淘汰赛');
  const t = teamById(state, teamId);
  if (!t) throw new Error(`队伍不存在: ${teamId}`);
  if (k.phase === 'done') throw new Error('赛事已结束');
  if (eliminatedIds(k).has(teamId)) throw new Error('该队已出局');

  // —— 决赛阶段：对手夺冠（由操作员触发本接口即视为手动判定）——
  if (k.phase === 'final') {
    const [a, b] = k.final.players;
    if (a !== teamId && b !== teamId) throw new Error('该队不在决赛中');
    const winner = a === teamId ? b : a;
    eliminate(state, k, teamId, '决赛弃赛');
    k.champion = winner;
    k.runnerUp = teamId;
    k.phase = 'done';
    log(k, `决赛选手 ${name(state, teamId)} 弃赛，${name(state, winner)} 夺冠`);
    return k;
  }

  // —— 志愿分配阶段：从录取名单摘除，角色与初始分重排，操作员重新分配 ——
  if (k.phase === 'assign') {
    k.order = k.order.filter((id) => id !== teamId);
    if (k.order.length < 2) throw new Error('剩余不足 2 队，淘汰赛无法继续');
    const s = state.settings;
    k.groups.A.defender = k.order[0];
    k.groups.B.defender = k.order[1];
    k.groups.A.queue = [];
    k.groups.B.queue = [];
    k.order.forEach((id, i) => {
      k.pts[id] = i < 2 ? s.defenderStart : s.attackerStart;
    });
    eliminate(state, k, teamId, '录取后退赛');
    log(k, `${name(state, teamId)} 退赛，防守方重排：A 守 ${name(state, k.order[0])} / B 守 ${name(state, k.order[1])}`);
    return k;
  }

  // —— 车轮战阶段 ——
  // 1) 先从所有进攻队列摘除
  for (const g of ['A', 'B']) {
    k.groups[g].queue = k.groups[g].queue.filter((id) => id !== teamId);
  }

  let heirInfo = null;
  for (const g of ['A', 'B']) {
    const cur = k.current[g];
    if (!cur) continue;

    if (cur.defender === teamId) {
      // 防守方退赛：本场取消（已录局分不结算）。
      // 继承算法：原进攻方回到待战队列首位 → 队列队首（即原进攻方，
      // 若其已出局则顺延下一位）接任防守方，随后开启下一场。
      k.current[g] = null;
      const grp = k.groups[g];
      const waiting = [cur.attacker, ...grp.queue]
        .filter((id) => !eliminatedIds(k).has(id) && id !== teamId);
      const heir = waiting.shift() || null;
      eliminate(state, k, teamId, `弃赛（${g} 组防守方）`);
      if (heir) {
        grp.defender = heir;
        grp.queue = waiting;
        k.pts[heir] = Math.min(k.pts[heir], state.settings.defenderCap); // 防守上限即时生效
        k.current[g] = grp.queue.length
          ? { defender: heir, attacker: grp.queue.shift(), games: [] }
          : null;
        heirInfo = { group: g, heir };
        log(k, `${g} 组防守方 ${name(state, teamId)} 弃赛 → ${name(state, heir)} 继承防守（积分 ${fmt(k.pts[heir])}，本场取消不结算）`);
      } else {
        grp.defender = null;
        grp.queue = [];
        log(k, `${g} 组防守方 ${name(state, teamId)} 弃赛且无人可继承，该组空缺`);
      }
    } else if (cur.attacker === teamId) {
      // 进攻方退赛：本场保留已录局分，标记待人工结算（不自动判分）
      cur.attackerWithdrawn = true;
      eliminate(state, k, teamId, `弃赛（${g} 组进攻方）`);
      log(k, `${g} 组进攻方 ${name(state, teamId)} 弃赛，本场待人工结算`);
    }
  }

  if (!heirInfo) eliminate(state, k, teamId, '弃赛');
  checkFieldEnd(state, k);
  return k;
}

// 弃赛场次的手动补判：判防守方胜（2:0），退赛者不扣分、不回队列
export function settleWalkover(state, group) {
  const k = state.knockout;
  if (!k || k.phase !== 'battle') throw new Error('当前不在车轮战阶段');
  const cur = k.current[group];
  if (!cur) throw new Error(`${group} 组当前没有进行中的场次`);
  if (!cur.attackerWithdrawn) throw new Error('该场无需补判（进攻方未退赛）');

  k.matchCounter += 1;
  const { defender, attacker } = cur;
  k.pts[defender] = Math.min(k.pts[defender] + 0.5, state.settings.defenderCap);
  k.matchWins[defender] += 1;
  log(k, `第${k.matchCounter}场（${group}组）进攻方弃赛，人工补判防守方 ${name(state, defender)} 胜`, {
    match: k.matchCounter, group, defender, attacker, winner: defender, walkover: true,
  });
  k.current[group] = k.groups[group].queue.length
    ? { defender: k.groups[group].defender, attacker: k.groups[group].queue.shift(), games: [] }
    : null;
  checkFieldEnd(state, k);
  return k;
}

export function recordFinalGame(state, outcome) {
  const k = state.knockout;
  if (!k || k.phase !== 'final') throw new Error('当前不在决赛阶段');
  if (!['a', 'b', 'draw'].includes(outcome)) throw new Error(`非法当局结果: ${outcome}`);
  k.final.games.push(outcome);
  const [a, b] = k.final.players;
  const aWins = k.final.games.filter((x) => x === 'a').length;
  const bWins = k.final.games.filter((x) => x === 'b').length;
  if (aWins < 2 && bWins < 2) return { done: false, games: k.final.games };

  k.champion = aWins >= 2 ? a : b;
  k.runnerUp = aWins >= 2 ? b : a;
  k.phase = 'done';
  log(k, `决赛结束：${name(state, k.champion)} 夺冠（${aWins}:${bWins}）`, { champion: k.champion });
  return { done: true, champion: k.champion, runnerUp: k.runnerUp };
}

// 季军及 3~8 名裁定：车轮战胜场 → 总积分 → 瑞士轮 ARO
export function knockoutRanking(state) {
  const k = state.knockout;
  if (!k) return [];
  const table = new Map(standings(state).map((r) => [r.teamId, r]));
  const rows = k.order.map((id) => ({
    teamId: id,
    name: name(state, id),
    pts: k.pts[id],
    matchWins: k.matchWins[id] || 0,
    swissAro: table.get(id)?.aro ?? 0,
    swissScore: table.get(id)?.score ?? 0,
    eliminated: eliminatedIds(k).has(id),
    eliminationOrder: k.eliminated.find((e) => e.id === id)?.order ?? null,
    role: {
      champion: k.champion === id,
      runnerUp: k.runnerUp === id,
    },
  }));
  const podium = [];
  if (k.champion) podium.push({ ...rows.find((r) => r.teamId === k.champion), finalRank: 1 });
  if (k.runnerUp) podium.push({ ...rows.find((r) => r.teamId === k.runnerUp), finalRank: 2 });
  const rest = rows
    .filter((r) => r.eliminated)
    .sort((x, y) =>
      y.matchWins - x.matchWins ||
      y.pts - x.pts ||
      y.swissAro - x.swissAro);
  rest.forEach((r, i) => { r.finalRank = 3 + i; });
  return [...podium, ...rest];
}

function name(state, id) {
  if (state) return teamById(state, id)?.name || id;
  return id; // eliminate() 内部拿不到 state 时的降级显示
}

function fmt(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
