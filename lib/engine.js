'use strict';
// ============================================================
// 杜博夫系统瑞士轮引擎（纯计算层，允许原地修改 state）
//
// 规则映射（条款号对应赛程文件）：
//  5.1  ARO = Σ(k_i × 对手当轮入场ARO) / 已赛场次；积分分组(胜3平1负0)；
//       组内 ARO 升序 → 折叠配对（最低配最高）；奇数组从下一低分组上调
//       ARO 最高者；批次随机。
//  5.2  淘汰赛见 knockout.js。
//  5.3.1 级联上调：自最高分组依序处理，奇数组上调下一组最高ARO者；
//       传导至最后一组仍奇数 → 组内 ARO 最低者轮空，其本轮 ARO 项 =
//       除本组外剩余队伍 ARO 均值。
//  5.3.2 荣誉系数：上调者胜 → 本轮对手ARO项 × promoteBase^n；
//       下调者负 → × demoteBase^n；n 由 honorExponentMode 决定
//       （'round'=当前轮数 / 'fixed1'=1 / 'streak'=连续上调/下调次数）。
//  5.3.3 首轮 ARO = 中期考核得分总分；首轮仅一组，奇数轮空ARO最低。
//  5.3.4 弃赛：轮中退出按本轮判负（保留该轮ARO项），此后不再参与排序。
//  5.3.5 重复对位：重复者中 ARO 较高者下调一组、较低者上调一组，
//       随后重跑 5.3.1 级联；无法按规则移动时强制配对并记 warning。
//  5.3.6 重赛（2026-10-22 增补）：本轮确认前按场登记——
//       'immediate'=清结果当场重录；'defer'=本轮暂记平局入队
//       swiss.rematchQueue，下一轮生成时强制再次对位（豁免 5.3.5，
//       不参与上调/下调标记），该场结果即重赛结果。
//  5.3.7 停赛与替补（2026-10-22 增补）：停赛=按场移除该队——本轮对位
//       已生成时该场判对手胜（walkover 式自动结算），后续轮次不再参与
//       （历史账目不变）；生成下一轮前可补位替补新队保证无轮空（默认
//       全负积分 0，初始 ARO=入场轮在赛队伍中位数），未补位按 5.3.1 轮空。
// ============================================================

export const DEFAULT_SETTINGS = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  byePoints: 3,            // 规则未规定轮空得分，默认记胜局分，可调
  promoteBase: 1.04,       // 上调组获胜荣誉系数底数
  demoteBase: 0.97,        // 下调组落败荣誉系数底数
  honorExponentMode: 'round', // 'round' | 'fixed1' | 'streak'
  defenderStart: 3,        // 淘汰赛防守方初始积分
  attackerStart: 2,        // 淘汰赛进攻方初始积分
  defenderCap: 4,          // 防守方积分上限
};

const r3 = (x) => Math.round(x * 1000) / 1000;
const now = () => new Date().toISOString();

export function newTournament({ name, totalRounds = 6, settings = {}, teams = [] } = {}) {
  const state = {
    version: 1,
    meta: {
      name: (name || '').trim() || '未命名赛事',
      createdAt: now(),
      totalRounds: Math.max(1, Math.min(20, Number(totalRounds) || 6)),
    },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    seq: { team: 0, request: 0 },
    teams: [],
    swiss: { rounds: [], rematchQueue: [] },
    requests: [], // 队员申请：{ id, type: 'withdraw'|'reschedule', teamId, status, reason, requestedAt, handledBy?, handledAt? }
    knockout: null,
  };
  addTeams(state, teams);
  return state;
}

// 旧档兼容：5.3.6 之前存档的赛事缺重赛队列
function ensureSwissFields(state) {
  if (!Array.isArray(state.swiss.rematchQueue)) state.swiss.rematchQueue = [];
}

// ---------- 队伍管理 ----------

export function addTeams(state, list) {
  const out = [];
  for (const item of list || []) {
    const name = String(item?.name ?? '').trim();
    if (!name) continue;
    state.seq.team += 1;
    const t = {
      id: `t${state.seq.team}`,
      name,
      initialScore: Math.max(0, Number(item?.initialScore) || 0),
      withdrawn: false,
      withdrawnAt: null,
    };
    state.teams.push(t);
    out.push(t);
  }
  return out;
}

export function teamById(state, id) {
  return state.teams.find((t) => t.id === id) || null;
}

export function activeTeams(state) {
  return state.teams.filter((t) => !t.withdrawn && !t.suspended);
}

export function updateTeam(state, id, patch) {
  const t = teamById(state, id);
  if (!t) throw new Error(`队伍不存在: ${id}`);
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (name) t.name = name;
  }
  if (patch.initialScore != null) t.initialScore = Math.max(0, Number(patch.initialScore) || 0);
  return t;
}

export function removeTeam(state, id) {
  if (state.swiss.rounds.length > 0) throw new Error('比赛已开始，不能删除队伍（请使用弃赛）');
  const i = state.teams.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`队伍不存在: ${id}`);
  state.teams.splice(i, 1);
}

// 5.3.4 弃赛：退赛状态由人工标记；标记后规则自动推进——
// 本轮进行中弃赛 → 该轮未录入的对局自动判负（walkover 标记），
// 该轮 ARO 项照常入账，此后所有排序剔除该队。
export function withdrawTeam(state, id, { midRound = true } = {}) {
  const t = teamById(state, id);
  if (!t) throw new Error(`队伍不存在: ${id}`);
  if (t.withdrawn) return t;
  t.withdrawn = true;
  t.withdrawnAt = now();

  const pending = pendingRound(state);
  if (midRound && pending) {
    if (pending.bye === id) {
      // 本轮轮空者退赛：轮空无对局可判负，取消本轮轮空
      pending.bye = null;
      pending.byeTerm = null;
    }
    for (const p of pending.pairings) {
      if ((p.a === id || p.b === id) && p.result == null) {
        p.result = p.a === id ? 'b' : 'a'; // 对手胜（判负）
        p.walkover = true;                 // 弃赛判负标记（展示用）
      }
    }
  }
  return t;
}

export function reinstateTeam(state, id) {
  const t = teamById(state, id);
  if (!t) throw new Error(`队伍不存在: ${id}`);
  t.withdrawn = false;
  t.withdrawnAt = null;
  t.suspended = false;
  t.suspendedAt = null;
  return t;
}

// ---------- 轮次查询 ----------

export function committedRounds(state) {
  return state.swiss.rounds.filter((r) => r.committed);
}

export function pendingRound(state) {
  const last = state.swiss.rounds[state.swiss.rounds.length - 1];
  return last && !last.committed ? last : null;
}

export function playedBefore(state, upto, a, b) {
  return committedRounds(state)
    .slice(0, upto)
    .some((r) => r.pairings.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)));
}

// ---------- 积分表 & ARO（由已确认轮次推导，可全程审计） ----------

// upto: 只统计前 upto 个已确认轮次（生成第 N 轮对阵时传 N-1）
export function computeTable(state, upto = Infinity) {
  const s = state.settings;
  const rounds = committedRounds(state).slice(0, upto);
  const rows = new Map();
  for (const t of state.teams) {
    rows.set(t.id, {
      teamId: t.id,
      initialScore: t.initialScore,
      withdrawn: !!t.withdrawn,
      suspended: !!t.suspended,
      score: 0, wins: 0, draws: 0, losses: 0, byes: 0, played: 0,
      aroSum: 0, aroRounds: 0, terms: [],
    });
  }
  const promStreak = new Map();
  const demStreak = new Map();

  for (const r of rounds) {
    const promoted = new Set(r.promoted || []);
    const demoted = new Set(r.demoted || []);
    const roundNo = r.round;

    const participants = new Set();
    for (const p of r.pairings) { participants.add(p.a); participants.add(p.b); }
    if (r.bye) participants.add(r.bye);
    for (const id of participants) {
      promStreak.set(id, promoted.has(id) ? (promStreak.get(id) || 0) + 1 : 0);
      demStreak.set(id, demoted.has(id) ? (demStreak.get(id) || 0) + 1 : 0);
    }
    const expFor = (kind, id) =>
      s.honorExponentMode === 'fixed1' ? 1
        : s.honorExponentMode === 'streak'
          ? (kind === 'p' ? promStreak.get(id) : demStreak.get(id))
          : roundNo; // 'round'（默认：指数=当前轮数）

    for (const p of r.pairings) {
      const A = rows.get(p.a);
      const B = rows.get(p.b);
      if (!A || !B) continue;
      A.played += 1; B.played += 1;
      let kA = 1, kB = 1;
      if (p.result === 'a') {
        A.score += s.winPoints; A.wins += 1;
        B.score += s.lossPoints; B.losses += 1;
        if (promoted.has(p.a)) kA = Math.pow(s.promoteBase, expFor('p', p.a));
        if (demoted.has(p.b)) kB = Math.pow(s.demoteBase, expFor('d', p.b));
      } else if (p.result === 'b') {
        B.score += s.winPoints; B.wins += 1;
        A.score += s.lossPoints; A.losses += 1;
        if (promoted.has(p.b)) kB = Math.pow(s.promoteBase, expFor('p', p.b));
        if (demoted.has(p.a)) kA = Math.pow(s.demoteBase, expFor('d', p.a));
      } else if (p.result === 'draw') {
        A.score += s.drawPoints; A.draws += 1;
        B.score += s.drawPoints; B.draws += 1;
      }
      // k 全精度入账（显示层再格式化），ARO 可由 terms 逐笔精确回放
      A.aroSum += kA * p.aroB; A.aroRounds += 1;
      A.terms.push({ round: roundNo, opp: p.b, R: p.aroB, k: kA });
      B.aroSum += kB * p.aroA; B.aroRounds += 1;
      B.terms.push({ round: roundNo, opp: p.a, R: p.aroA, k: kB });
    }

    if (r.bye && rows.has(r.bye)) {
      const T = rows.get(r.bye);
      const R = Number(r.byeTerm) || 0;
      T.score += s.byePoints; T.byes += 1; T.played += 1;
      T.aroSum += R; T.aroRounds += 1;
      T.terms.push({ round: roundNo, opp: null, R, k: 1, bye: true });
    }
  }

  for (const row of rows.values()) {
    // 5.3.3：未参赛时 ARO = 中期考核得分总分
    row.aro = row.aroRounds > 0 ? r3(row.aroSum / row.aroRounds) : r3(row.initialScore);
    delete row.aroSum;
  }
  return rows;
}

// 排名：积分降序 → ARO 降序 → 初始分降序 → 名称（淘汰赛录取同序）
export function standings(state, upto = Infinity) {
  const table = computeTable(state, upto);
  const list = [...table.values()].map((row) => ({ ...row, team: teamById(state, row.teamId) }));
  list.sort((x, y) =>
    y.score - x.score ||
    y.aro - x.aro ||
    y.initialScore - x.initialScore ||
    x.team.name.localeCompare(y.team.name, 'zh'));
  list.forEach((row, i) => { row.rank = i + 1; });
  return list;
}

// ---------- 生成一轮对阵（5.1 + 5.3.1 + 5.3.5） ----------

export function generateRound(state) {
  if (pendingRound(state)) throw new Error('上一轮尚未确认，无法生成新对阵');
  const done = committedRounds(state).length;
  if (done >= state.meta.totalRounds) throw new Error('瑞士轮轮次已全部完成');
  ensureSwissFields(state);
  // 5.3.7 停赛队等同移除，activeTeams 已剔除
  const active = activeTeams(state);
  if (active.length < 2) throw new Error('可参赛队伍不足 2 支');

  const warnings = [];
  // 5.3.6 下轮再重赛：消费重赛队列，强制对位（豁免 5.3.5，不参与上调/下调）
  const forced = [];
  const forcedIds = new Set();
  state.swiss.rematchQueue = state.swiss.rematchQueue.filter((q) => {
    const inTeam = (id) => active.some((t) => t.id === id);
    if (!inTeam(q.a) || !inTeam(q.b)) {
      warnings.push(`重赛作废：${teamById(state, q.a)?.name || q.a} × ${teamById(state, q.b)?.name || q.b}（第 ${q.fromRound} 轮暂记平局）一方停赛或弃赛，本轮不再重赛`);
      return false;
    }
    forced.push({ a: q.a, b: q.b, rematchOf: q.fromRound });
    forcedIds.add(q.a);
    forcedIds.add(q.b);
    return false;
  });
  // 正常配对池 = 本轮可赛队伍 - 重赛占用者
  const pool = active.filter((t) => !forcedIds.has(t.id));

  const table = computeTable(state, done);
  const aroOf = new Map([...table.values()].map((r) => [r.teamId, r.aro]));
  const scoreOf = new Map([...table.values()].map((r) => [r.teamId, r.score]));
  const cmp = (x, y) =>
    (aroOf.get(x) - aroOf.get(y)) ||
    (teamById(state, x).initialScore - teamById(state, y).initialScore) ||
    x.localeCompare(y);

  // 积分组（分数降序），组内 ARO 升序（仅配对池；重赛占用者不参与分组）
  const activeIds = new Set(pool.map((t) => t.id));
  const scoreKeys = [...new Set([...table.values()].filter((r) => activeIds.has(r.teamId)).map((r) => r.score))]
    .sort((a, b) => b - a);
  const groups = scoreKeys.map((sc) =>
    pool.filter((t) => scoreOf.get(t.id) === sc).map((t) => t.id).sort(cmp));
  const origScoreOf = new Map();
  groups.forEach((g, i) => g.forEach((id) => origScoreOf.set(id, scoreKeys[i])));

  let bye = null;
  let byeTerm = null;

  // 5.3.1 级联：自最高分组依序，奇数组上调下一组 ARO 最高者；最后一组奇数 → ARO 最低者轮空
  let byeGroupIdx = -1;
  function cascade() {
    // 5.3.5 消解会多次重跑级联：先归还上一轮的轮空者，避免其被吞
    if (bye != null && byeGroupIdx >= 0 && byeGroupIdx < groups.length) {
      groups[byeGroupIdx].push(bye);
      groups[byeGroupIdx].sort(cmp);
    }
    bye = null; byeTerm = null; byeGroupIdx = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].length % 2 !== 1) continue;
      // 5.3.5 移动可能把中间组移空：向下找最近的非空组作为「下一低分组」
      let j = i + 1;
      while (j < groups.length && groups[j].length === 0) j++;
      if (j < groups.length) {
        const up = groups[j].pop(); // 该组 ARO 最高者（升序末位）
        groups[i].push(up);
        groups[i].sort(cmp);
      } else {
        // 下方已无队伍：本组即最低有效组，ARO 最低者轮空
        bye = groups[i].shift();
        byeGroupIdx = i;
        const inGroup = new Set(groups[i]);
        const others = active.map((t) => t.id).filter((id) => !inGroup.has(id) && id !== bye);
        if (others.length > 0) {
          byeTerm = others.reduce((s, x) => s + aroOf.get(x), 0) / others.length;
        } else {
          // 首轮仅一组时的边界：回退为本组其余队伍均值
          const mates = groups[i];
          byeTerm = mates.length ? mates.reduce((s, x) => s + aroOf.get(x), 0) / mates.length : 0;
        }
      }
    }
  }

  // 折叠配对：组内 ARO 最低 × 最高，次低 × 次高
  function foldPairs() {
    const pairs = [];
    for (const g of groups) {
      const n = g.length;
      for (let j = 0; j < Math.floor(n / 2); j++) pairs.push({ a: g[j], b: g[n - 1 - j] });
    }
    return pairs;
  }

  const groupIndex = (id) => groups.findIndex((g) => g.includes(id));
  const removeFrom = (id) => {
    const gi = groupIndex(id);
    groups[gi].splice(groups[gi].indexOf(id), 1);
    return gi;
  };
  const insertInto = (gi, id) => {
    groups[gi].push(id);
    groups[gi].sort(cmp);
  };

  let finalPairs = null;
  let forcedConflicts = null;

  // 5.3.5 消解循环：移动 → 重跑级联 → 重新折叠
  for (let attempt = 0; attempt < 300; attempt++) {
    cascade();
    const pairs = foldPairs();
    const conflicts = pairs.filter((p) => playedBefore(state, done, p.a, p.b));
    if (conflicts.length === 0) { finalPairs = pairs; forcedConflicts = []; break; }

    let unfixable = false;
    for (const c of conflicts) {
      const [hi, lo] = aroOf.get(c.a) >= aroOf.get(c.b) ? [c.a, c.b] : [c.b, c.a];
      const gi = groupIndex(hi);
      if (gi < 0) { unfixable = true; continue; } // 防御：定位失败不崩溃
      if (gi + 1 < groups.length && gi - 1 >= 0) {
        removeFrom(hi); insertInto(gi + 1, hi); // ARO 较高者下调
        removeFrom(lo); insertInto(gi - 1, lo); // ARO 较低者上调
      } else {
        unfixable = true;
      }
    }
    if (unfixable) {
      finalPairs = pairs;
      forcedConflicts = conflicts;
      warnings.push('存在无法按 5.3.5 移动的重复对位（处于边界组别），已强制保留，请人工复核');
      break;
    }
  }
  if (!finalPairs) {
    cascade();
    finalPairs = foldPairs();
    forcedConflicts = finalPairs.filter((p) => playedBefore(state, done, p.a, p.b));
    warnings.push('重复对位消解超出迭代上限，已强制保留当前对阵，请人工复核');
  }
  for (const c of forcedConflicts || []) {
    warnings.push(`重复对位（强制保留）：${teamById(state, c.a)?.name} × ${teamById(state, c.b)?.name} 此前已交手`);
  }
  // 5.3.6 强制重赛对位并入，与正常对局一同随机分批
  finalPairs = [...forced, ...finalPairs];

  // 上调/下调标记：以最终所在组别分数相对原始组别分数判定
  const postScoreOf = new Map();
  groups.forEach((g, i) => g.forEach((id) => postScoreOf.set(id, scoreKeys[i])));
  const promoted = [];
  const demoted = [];
  for (const [id, orig] of origScoreOf) {
    if (id === bye) continue;
    const cur = postScoreOf.get(id);
    if (cur > orig) promoted.push(id);
    else if (cur < orig) demoted.push(id);
  }

  // 批次随机（5.1.6）
  const shuffled = [...finalPairs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const record = {
    round: done + 1,
    committed: false,
    generatedAt: now(),
    aroEntering: Object.fromEntries(active.map((t) => [t.id, r3(aroOf.get(t.id))])),
    pairings: shuffled.map((p, i) => ({
      board: i + 1,
      a: p.a, b: p.b,
      aroA: r3(aroOf.get(p.a)), aroB: r3(aroOf.get(p.b)),
      result: null, autoLoss: false,
      ...(p.rematchOf ? { rematchOf: p.rematchOf } : {}),
    })),
    bye: bye || null,
    byeTerm: byeTerm == null ? null : r3(byeTerm),
    promoted, demoted, warnings,
  };
  state.swiss.rounds.push(record);
  return record;
}

// ---------- 录入与确认 ----------

export function submitResults(state, results) {
  const round = pendingRound(state);
  if (!round) throw new Error('当前没有待录入的对轮');
  for (const { board, result } of results || []) {
    const p = round.pairings.find((x) => x.board === Number(board));
    if (!p) throw new Error(`局号不存在: ${board}`);
    if (result === 'reset') {
      // 重赛：清除已录结果；弃赛判负由规则自动结算，不走此通道
      if (p.walkover) throw new Error('该场为弃赛自动判负（条款 5.3.4），不能重赛；如需调整请先恢复该队参赛状态');
      p.result = null;
      continue;
    }
    if (!['a', 'b', 'draw'].includes(result)) throw new Error(`非法结果: ${result}`);
    p.result = result;
  }
  return round;
}

// ---------- 5.3.6 重赛 / 5.3.7 停赛（本轮确认前登记） ----------

// 下轮再重赛：本场本轮暂记平局（保障赛程），入队下一轮强制对位（豁免 5.3.5）
export function deferRematch(state, board) {
  ensureSwissFields(state);
  const round = pendingRound(state);
  if (!round) throw new Error('当前没有待确认的轮次');
  const p = round.pairings.find((x) => x.board === Number(board));
  if (!p) throw new Error(`局号不存在: ${board}`);
  if (p.walkover) throw new Error('该场为弃赛自动判负（条款 5.3.4），不能重赛');
  if (p.rematchDefer) throw new Error('该场已登记下轮重赛');
  p.result = 'draw';
  p.rematchDefer = true;
  state.swiss.rematchQueue.push({ a: p.a, b: p.b, fromRound: round.round });
  return round;
}

// 停赛查询：该队是否处于停赛移除状态
export function isSuspended(team) {
  return !!team?.suspended;
}

// 5.3.7 停赛：按场移除该队。本轮对位已生成时该场判对手胜（未录入的
// 自动判负带 walkover 标记，已录结果保留），后续轮次不再参与；
// 历史轮次账目不变。奇数轮空由「补位替补」（addTeams）或 5.3.1 兜底。
export function suspendTeam(state, teamId) {
  ensureSwissFields(state);
  const t = teamById(state, teamId);
  if (!t) throw new Error(`队伍不存在: ${teamId}`);
  if (t.withdrawn) throw new Error('该队伍已退赛，无需停赛');
  if (t.suspended) return t;
  if (state.knockout) throw new Error('淘汰赛阶段不支持停赛，请使用退赛');
  t.suspended = true;
  t.suspendedAt = now();
  // 该队名下的下轮重赛义务作废（无论停赛时是否有进行中轮次）
  state.swiss.rematchQueue = state.swiss.rematchQueue.filter((q) => q.a !== teamId && q.b !== teamId);

  const pending = pendingRound(state);
  if (pending) {
    if (pending.bye === teamId) {
      pending.bye = null;
      pending.byeTerm = null;
    }
    for (const p of pending.pairings) {
      if ((p.a === teamId || p.b === teamId) && p.result == null) {
        p.result = p.a === teamId ? 'b' : 'a'; // 对手胜（停赛判负）
        p.walkover = true;
      }
    }
  }
  return t;
}

export function commitRound(state) {
  const round = pendingRound(state);
  if (!round) throw new Error('当前没有待确认的轮次');
  const missing = round.pairings.filter((p) => p.result == null);
  if (missing.length > 0) {
    throw new Error(`还有 ${missing.length} 场对局未录入结果（批次 ${missing.map((p) => p.board).join(', ')}）`);
  }
  round.committed = true;
  round.committedAt = now();
  return round;
}

export function regenerateRound(state) {
  const round = pendingRound(state);
  if (!round) throw new Error('没有可重新生成的轮次（当前轮已确认）');
  state.swiss.rounds.pop();
  return generateRound(state);
}

export function swissComplete(state) {
  return committedRounds(state).length >= state.meta.totalRounds;
}

// ---------- 队员申请（弃赛 / 场次调换，队员提出、管理员落地） ----------
// 5.3.4：轮开始 1h 前可申请场次调换（本组排至本轮最后一局）；进行中弃赛/退赛判负并剔除

export function addRequest(state, { type, teamId, reason }) {
  if (!['withdraw', 'reschedule'].includes(type)) throw new Error(`非法申请类型: ${type}`);
  const t = teamById(state, teamId);
  if (!t) throw new Error(`队伍不存在: ${teamId}`);
  if (state.knockout && type === 'reschedule') throw new Error('淘汰赛阶段无场次调换');
  if (t.withdrawn) throw new Error('该队伍已退赛');

  const pendingSame = state.requests.find(
    (r) => r.teamId === teamId && r.type === type && r.status === 'pending');
  if (pendingSame) throw new Error('已有同类型申请待处理，请等待管理员处理');

  const pending = pendingRound(state);
  if (type === 'reschedule') {
    if (!pending) throw new Error('当前没有进行中的轮次可调换');
    const mine = pending.pairings.find((p) => (p.a === teamId || p.b === teamId) && p.result == null);
    if (!mine) throw new Error('本队本轮没有待录入的对局（可能已录入结果或轮空）');
  }
  if (type === 'withdraw' && state.knockout) {
    // 淘汰赛阶段弃赛申请同样可提，管理员批准时走判负推进
  }

  state.seq.request += 1;
  const req = {
    id: `rq${state.seq.request}`,
    type, // 'withdraw' 弃赛 | 'reschedule' 场次调换
    teamId,
    status: 'pending', // pending → approved / rejected
    reason: String(reason || '').trim().slice(0, 200),
    requestedAt: now(),
  };
  state.requests.push(req);
  return req;
}

export function getRequest(state, id) {
  return state.requests.find((r) => r.id === id) || null;
}

// 批准弃赛申请：走既有判负推进（瑞士轮判负 / 淘汰赛判负推进由 api 分发）
export function approveWithdraw(state, requestId) {
  const req = getRequest(state, requestId);
  if (!req || req.type !== 'withdraw') throw new Error('申请不存在或类型不符');
  if (req.status !== 'pending') throw new Error(`该申请已处理（${req.status}）`);
  withdrawTeam(state, req.teamId, { midRound: true });
  req.status = 'approved';
  req.handledAt = now();
  return req;
}

// 批准调换申请：本轮该局排至最后一局（5.3.4 场次调换）
export function approveReschedule(state, requestId) {
  const req = getRequest(state, requestId);
  if (!req || req.type !== 'reschedule') throw new Error('申请不存在或类型不符');
  if (req.status !== 'pending') throw new Error(`该申请已处理（${req.status}）`);
  rescheduleBoard(state, req.teamId);
  req.status = 'approved';
  req.handledAt = now();
  return req;
}

export function rejectRequest(state, requestId) {
  const req = getRequest(state, requestId);
  if (!req) throw new Error('申请不存在');
  if (req.status !== 'pending') throw new Error(`该申请已处理（${req.status}）`);
  req.status = 'rejected';
  req.handledAt = now();
  return req;
}

// 场次调换：未确认轮次中该队对局的批次排到最后（条款 5.3.4 第一款）
export function rescheduleBoard(state, teamId) {
  const pending = pendingRound(state);
  if (!pending) throw new Error('当前没有待确认的轮次');
  const mine = pending.pairings.find((p) => p.a === teamId || p.b === teamId);
  if (!mine) throw new Error('本轮对阵中没有该队伍');
  if (mine.result != null) throw new Error('该场对局已录入结果，无法调换');
  const last = pending.pairings[pending.pairings.length - 1];
  if (last === mine) throw new Error('该局已经是最后一局');
  // 移到数组末尾并整轮重编批次号（result 挂在对局对象上，不会错位）
  pending.pairings = pending.pairings.filter((p) => p !== mine).concat(mine);
  pending.pairings.forEach((p, i) => { p.board = i + 1; });
  return pending;
}
