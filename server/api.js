'use strict';
// REST API + SSE 实时推送 + 认证/权限/审计
//
// 权限矩阵（服务端强制，前端仅做 UX 隐藏）：
//   公开（免登录）：查询状态/SSE/排名CSV导出/登录
//   player（队员）：以上 + 查看「我的比赛」+ 提交弃赛/场次调换申请（管理员落地）
//   referee（裁判）：以上 + 录入对局结果、确认轮次、淘汰赛录局与决赛录入
//   admin（管理员）：其余全部（建赛/销毁/设置/名册/生成对阵/退赛/撤销/申请处理/审计/全量导出）
import express from 'express';
import * as store from './store.js';
import * as auth from './auth.js';
import { audit, readAudit } from './audit.js';
import {
  newTournament, addTeams, updateTeam, removeTeam, withdrawTeam, reinstateTeam,
  generateRound, submitResults, commitRound, regenerateRound,
  pendingRound, committedRounds, standings,
  addRequest, getRequest, approveReschedule, rejectRequest,
  deferRematch, rematchNow, movePairing, overturnResult, addExtraMatch, assignBye, removeTeamHard, setRoundTimeOffset, suspendTeam, forfeitTeam, benchTeams, addBenchTeam, activateBench, removeBench,
} from '../lib/engine.js';
import {
  initKnockout, assignAttackers, playGame, recordFinalGame, knockoutRanking,
  withdrawFromKnockout,
} from '../lib/knockout.js';

const sseClients = new Set();

function clientIp(req) {
  return req.socket?.remoteAddress || '-';
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(view(null))}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* 客户端断开由 close 统一清理 */ }
  }
}

// 面向前端的单一视图载荷：状态 + 派生数据一次给全
// me：当前会话用户（按请求个体计算，广播时为 null）
function view(me) {
  const state = store.get();
  if (!state) return { hasTournament: false, canUndo: store.canUndo(), serverTime: Date.now(), me };
  const done = committedRounds(state).length;
  // 下一轮信息（5.3.7 替补录入用）：轮次号 + 在赛队伍 ARO 中位数（偶数取中间均值）
  const nextRoundNo = state.swiss.rounds.length + 1;
  const aros = standings(state)
    .filter((r) => !r.withdrawn && !r.suspended && !r.forfeited && !r.bench)
    .map((r) => r.aro)
    .sort((a, b) => a - b);
  const medianAro = aros.length
    ? (aros.length % 2 ? aros[(aros.length - 1) / 2] : (aros[aros.length / 2 - 1] + aros[aros.length / 2]) / 2)
    : 0;
  return {
    hasTournament: true,
    state,
    standings: standings(state),
    knockoutRanking: state.knockout ? knockoutRanking(state) : null,
    pending: pendingRound(state),
    swissDone: done >= state.meta.totalRounds,
    swissProgress: { done, total: state.meta.totalRounds },
    nextRound: {
      no: nextRoundNo,
      medianAro: Math.round(medianAro * 1000) / 1000,
      activeCount: aros.length,
    },
    canUndo: store.canUndo(),
    undoLabel: store.lastSnapshotLabel(),
    me,
    serverTime: Date.now(),
  };
}

// perm: null 公开 | 'player' 队员及以上 | 'referee' 裁判及以上 | 'admin' 仅管理员
const ROLE_LEVEL = { anonymous: 0, player: 1, referee: 2, admin: 3 };
function hasPerm(user, perm) {
  if (!perm) return true;
  if (!user) return false;
  return (ROLE_LEVEL[user.role] || 0) >= (ROLE_LEVEL[perm] || 99);
}

function wrap(label, fn, { needState = true, perm = 'admin', snapshot = true } = {}) {
  return (req, res) => {
    const who = req.user || { name: '-', role: 'anonymous' };
    const finish = (ok, extra = {}) => {
      audit({
        user: who.name, role: who.role, action: label, ok,
        error: ok ? '' : (extra.error || ''),
        ip: clientIp(req), path: req.originalUrl,
      });
    };
    try {
      if (perm) {
        if (!req.user) {
          finish(false, { error: '需要登录' });
          return res.status(401).json({ ok: false, error: '需要登录' });
        }
        if (!hasPerm(req.user, perm)) {
          finish(false, { error: '权限不足' });
          return res.status(403).json({ ok: false, error: '权限不足' });
        }
      }
      if (needState && !store.get()) throw new Error('尚未创建赛事，请先在赛前设置中建赛');
      // 撤销不能先压快照——否则 undo() 弹出的正是刚压入的自身快照，等于空操作
      if (snapshot) store.snapshot(label);
      const result = fn(req) ?? {};
      store.save();
      broadcast();
      finish(true);
      res.json({ ok: true, ...result });
    } catch (err) {
      finish(false, { error: err.message });
      res.status(400).json({ ok: false, error: err.message });
    }
  };
}

export function createApiRouter() {
  const api = express.Router();

  // 会话解析：x-session 头 → req.user
  api.use((req, _res, next) => {
    const token = req.get('x-session');
    req.user = auth.userForToken(token);
    req.sessionToken = token || null;
    next();
  });

  api.get('/state', (req, res) => res.json(view(req.user)));

  api.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify(view(req.user))}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  });

  // ---- 认证 ----
  api.post('/auth/login', (req, res) => {
    const { name, password } = req.body || {};
    const result = auth.login(name, password);
    audit({
      user: String(name || '?'), role: result ? result.user.role : '-',
      action: '登录', ok: !!result, error: result ? '' : '密码或用户名错误',
      ip: clientIp(req), path: '/api/auth/login',
    });
    if (!result) return res.status(401).json({ ok: false, error: '用户名或密码错误' });
    res.json({ ok: true, ...result });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) auth.logout(req.sessionToken);
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    res.json({ ok: true, me: req.user || null });
  });

  // ---- 审计（仅管理员）----
  api.get('/audit', wrap('查看审计日志', (req) => ({ entries: readAudit(Number(req.query.limit) || 300) }), { needState: false }));

  // ---- 赛事（管理员）----
  api.post('/tournament', wrap('创建赛事', (req) => {
    if (store.get()) throw new Error('已存在赛事，请先在设置页销毁重建');
    const { name, totalRounds, settings, teams } = req.body || {};
    const state = newTournament({ name, totalRounds, settings, teams });
    store.set(state);
  }, { needState: false }));

  api.post('/tournament/reset', wrap('销毁赛事', () => {
    store.set(null);
  }, { needState: false }));

  api.put('/settings', wrap('修改设置', (req) => {
    const state = store.get();
    const { meta, settings } = req.body || {};
    if (meta?.name) state.meta.name = String(meta.name).trim().slice(0, 60);
    if (meta?.totalRounds != null) {
      const n = Math.max(1, Math.min(20, Number(meta.totalRounds) || 6));
      if (n < committedRounds(state).length) throw new Error('轮次不能小于已完成轮数');
      state.meta.totalRounds = n;
    }
    const allowed = ['winPoints', 'drawPoints', 'lossPoints', 'byePoints', 'promoteBase', 'demoteBase', 'honorExponentMode', 'defenderStart', 'attackerStart', 'defenderCap', 'scheduleOffsetMin'];
    for (const key of allowed) {
      if (settings?.[key] !== undefined) state.settings[key] = settings[key];
    }
  }));

  // 撤销：不压快照、无赛事时也允许（销毁赛事后可反悔恢复）；返回被恢复操作的标签
  api.post('/undo', wrap('撤销', () => ({ label: store.undo() }), { needState: false, snapshot: false }));

  // ---- 队伍（管理员）----
  api.post('/teams', wrap('添加队伍', (req) => {
    const state = store.get();
    const added = addTeams(state, req.body?.teams || []);
    if (!added.length) throw new Error('没有有效的队伍数据');
  }));

  api.put('/teams/:id', wrap('修改队伍', (req) => {
    updateTeam(store.get(), req.params.id, req.body || {});
  }));

  api.delete('/teams/:id', wrap('删除队伍', (req) => {
    if (req.query.force === '1') removeTeamHard(store.get(), req.params.id);
    else removeTeam(store.get(), req.params.id);
  }));

  api.post('/teams/:id/withdraw', wrap('队伍退赛', (req) => {
    const state = store.get();
    const k = state.knockout;
    if (k && ['assign', 'battle', 'final', 'done'].includes(k.phase)) {
      withdrawFromKnockout(state, req.params.id);
    } else {
      withdrawTeam(state, req.params.id, { midRound: req.body?.midRound !== false });
    }
  }));

  api.post('/teams/:id/reinstate', wrap('队伍恢复', (req) => {
    reinstateTeam(store.get(), req.params.id);
  }));

  // ---- 瑞士轮：生成/重排为管理员；录入与确认为裁判及以上 ----
  api.post('/swiss/generate', wrap('生成对阵', () => {
    generateRound(store.get());
  }));

  api.post('/swiss/regenerate', wrap('重新生成对阵', () => {
    regenerateRound(store.get());
  }));

  api.post('/swiss/results', wrap('录入结果', (req) => {
    submitResults(store.get(), req.body?.results || []);
  }, { perm: 'referee' }));

  api.post('/swiss/commit', wrap('确认本轮', () => {
    commitRound(store.get());
  }, { perm: 'referee' }));

  // 5.3.6 下轮再重赛：本场本轮暂记平局，下一轮强制对位（本轮立刻重赛走 /swiss/results reset）
  api.post('/swiss/defer-rematch', wrap('登记下轮重赛', (req) => {
    deferRematch(store.get(), req.body?.board);
  }));

  // 手动调整局序：局号重编，批次/场地/时间随新局号重算
  // 按轮独立顺延（管理员）：单轮批次时间整体后移
  // 改判（管理员）：修正已确认轮次的对局结果
  api.post('/swiss/overturn', wrap('改判历史结果', (req) => {
    overturnResult(store.get(), req.body?.round, req.body?.board, req.body?.result);
  }));

  // 补录对局（管理员）：向待录轮次追加一局
  api.post('/swiss/extra-match', wrap('补录对局', (req) => {
    addExtraMatch(store.get(), req.body?.a, req.body?.b);
  }));

  // 手动轮空（管理员）：为本轮未排到对局的在赛队伍指定轮空
  api.post('/swiss/bye', wrap('手动轮空', (req) => {
    assignBye(store.get(), req.body?.teamId);
  }));

    api.post('/swiss/time-offset', wrap('按轮顺延设置', (req) => {
    setRoundTimeOffset(store.get(), req.body?.round, req.body?.offsetMin);
  }));

    api.post('/swiss/move-pairing', wrap('调整局序', (req) => {
    movePairing(store.get(), req.body?.board, req.body?.delta);
  }));

    // 5.3.6 本轮立刻重赛：清结果 + 调至本轮最后一局（其余局次前移）
  api.post('/swiss/rematch-now', wrap('本轮立刻重赛', (req) => {
    rematchNow(store.get(), req.body?.board);
  }, { perm: 'referee' }));

  // 5.3.7 停赛：直接移除该队（本轮对位判对手胜）
  api.post('/swiss/suspend', wrap('停赛移除', (req) => {
    suspendTeam(store.get(), req.body?.teamId);
  }));

  // 5.3.7 弃赛：移除该队，候补首位顶替出战该局（候补空则判对手胜）
  api.post('/swiss/forfeit', wrap('弃赛移除', (req) => {
    forfeitTeam(store.get(), req.body?.teamId);
  }));

  // 候补队列：录入 / 转正 / 移除
  api.post('/teams/bench', wrap('候补录入', (req) => {
    const t = addBenchTeam(store.get(), { name: req.body?.name, initialScore: req.body?.initialScore });
    return { team: t };
  }));
  api.post('/teams/bench/:id/activate', wrap('候补转正', (req) => {
    activateBench(store.get(), req.params.id);
  }));
  api.post('/teams/bench/:id/remove', wrap('候补移除', (req) => {
    removeBench(store.get(), req.params.id);
  }));

  // ---- 淘汰赛：录取/编组/退赛为管理员；录局与决赛为裁判及以上 ----
  api.post('/knockout/init', wrap('录取8强', () => {
    initKnockout(store.get());
  }));

  // 重置淘汰赛（管理员）：尚未产生任何场次时可用（志愿分配或已编组未开打）
  // ——录取/编组有误时重来；一旦录过局即锁定
  api.delete('/knockout', wrap('重置淘汰赛', () => {
    const state = store.get();
    const k = state.knockout;
    const started = k && (k.matchCounter > 0 || k.log.some((l) => l.match));
    if (started) throw new Error('淘汰赛已产生场次，不可重置');
    state.knockout = null;
  }));

  api.post('/knockout/assign', wrap('编组进攻队列', (req) => {
    assignAttackers(store.get(), req.body?.assignment || {});
  }));

  api.post('/knockout/game', wrap('录入对局', (req) => {
    playGame(store.get(), req.body?.group, req.body?.outcome);
  }, { perm: 'referee' }));

  api.post('/knockout/final', wrap('录入决赛对局', (req) => {
    recordFinalGame(store.get(), req.body?.outcome);
  }, { perm: 'referee' }));

  // ---- 队员申请（player 提出，管理员落地；5.3.4）----
  api.post('/requests', wrap('提交申请', (req) => {
    const state = store.get();
    const me = req.user;
    let teamId = me.teamId;
    if (me.role === 'admin' && req.body?.teamId) teamId = req.body.teamId; // 管理员可代提
    if (!teamId) throw new Error('当前账号未绑定队伍，无法提交申请');
    const request = addRequest(state, { type: req.body?.type, teamId, reason: req.body?.reason });
    return { request };
  }, { perm: 'player' }));

  api.post('/requests/:id/approve', wrap('批准申请', (req) => {
    const state = store.get();
    const request = getRequest(state, req.params.id);
    if (!request) throw new Error('申请不存在');
    if (request.type === 'withdraw') {
      // 弃赛：按当前阶段分发（瑞士轮判负 / 淘汰赛判负推进），与人工退赛同一套规则
      const k = state.knockout;
      if (k && ['assign', 'battle', 'final', 'done'].includes(k.phase)) {
        withdrawFromKnockout(state, request.teamId);
      } else {
        withdrawTeam(state, request.teamId, { midRound: true });
      }
      request.status = 'approved';
      request.handledAt = new Date().toISOString();
    } else {
      approveReschedule(state, req.params.id);
    }
  }, { perm: 'admin' }));

  api.post('/requests/:id/reject', wrap('拒绝申请', (req) => {
    rejectRequest(store.get(), req.params.id);
  }, { perm: 'admin' }));

  // ---- 导出：排名CSV公开（公示），全量JSON仅管理员 ----
  api.get('/export/json', (req, res) => {
    const allowed = req.user?.role === 'admin';
    audit({
      user: req.user?.name || '-', role: req.user?.role || '-', action: '导出全量JSON',
      ok: allowed, error: allowed ? '' : '需要管理员权限', ip: clientIp(req), path: req.originalUrl,
    });
    if (!allowed) return res.status(403).json({ ok: false, error: '需要管理员权限' });
    const state = store.get();
    if (!state) return res.status(404).json({ ok: false, error: '尚未创建赛事' });
    res.set('Content-Disposition', 'attachment; filename="tournament.json"');
    res.json(view(null));
  });

  api.get('/export/standings.csv', (req, res) => {
    const state = store.get();
    if (!state) return res.status(404).json({ ok: false, error: '尚未创建赛事' });
    const rows = standings(state);
    const lines = ['名次,队伍,中期考核分,积分,ARO,胜,平,负,轮空,已赛场次,状态'];
    for (const r of rows) {
      const status = r.bench ? '候补' : r.withdrawn ? '退赛' : r.suspended ? '停赛' : r.forfeited ? '弃赛' : '';
      lines.push([r.rank, csv(r.team.name), r.initialScore, r.score, r.aro, r.wins, r.draws, r.losses, r.byes, r.played, status].join(','));
    }
    if (state.knockout) {
      lines.push('');
      lines.push('最终名次,队伍,车轮战胜场,总积分,瑞士轮ARO');
      for (const r of knockoutRanking(state)) {
        lines.push([r.finalRank, csv(r.name), r.matchWins, r.pts, r.swissAro].join(','));
      }
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="standings.csv"');
    res.send('\ufeff' + lines.join('\r\n')); // BOM 方便 Excel 识别 UTF-8
  });

  return api;
}

function csv(x) {
  const s = String(x ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
