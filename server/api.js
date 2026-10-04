'use strict';
// REST API + SSE 实时推送 + 认证/权限/审计
//
// 权限矩阵（服务端强制，前端仅做 UX 隐藏）：
//   公开（免登录）：查询状态/SSE/排名CSV导出/登录
//   referee（裁判）：录入对局结果、确认轮次、淘汰赛录局与决赛录入
//   admin（管理员）：其余全部（建赛/销毁/设置/名册/生成对阵/退赛/撤销/审计/全量导出）
import express from 'express';
import * as store from './store.js';
import * as auth from './auth.js';
import { audit, readAudit } from './audit.js';
import {
  newTournament, addTeams, updateTeam, removeTeam, withdrawTeam, reinstateTeam,
  generateRound, submitResults, commitRound, regenerateRound,
  pendingRound, committedRounds, standings,
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
  return {
    hasTournament: true,
    state,
    standings: standings(state),
    knockoutRanking: state.knockout ? knockoutRanking(state) : null,
    pending: pendingRound(state),
    swissDone: done >= state.meta.totalRounds,
    swissProgress: { done, total: state.meta.totalRounds },
    canUndo: store.canUndo(),
    undoLabel: store.lastSnapshotLabel(),
    me,
    serverTime: Date.now(),
  };
}

// perm: null 公开 | 'referee' 裁判及以上 | 'admin' 仅管理员
function wrap(label, fn, { needState = true, perm = 'admin' } = {}) {
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
        if (perm === 'admin' && req.user.role !== 'admin') {
          finish(false, { error: '需要管理员权限' });
          return res.status(403).json({ ok: false, error: '需要管理员权限' });
        }
      }
      if (needState && !store.get()) throw new Error('尚未创建赛事，请先在赛前设置中建赛');
      store.snapshot(label);
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
    const allowed = ['winPoints', 'drawPoints', 'lossPoints', 'byePoints', 'promoteBase', 'demoteBase', 'honorExponentMode', 'defenderStart', 'attackerStart', 'defenderCap'];
    for (const key of allowed) {
      if (settings?.[key] !== undefined) state.settings[key] = settings[key];
    }
  }));

  api.post('/undo', wrap('撤销', () => {
    store.undo();
  }));

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
    removeTeam(store.get(), req.params.id);
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

  // ---- 淘汰赛：录取/编组/退赛为管理员；录局与决赛为裁判及以上 ----
  api.post('/knockout/init', wrap('录取8强', () => {
    initKnockout(store.get());
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
    const lines = ['名次,队伍,中期考核分,积分,ARO,胜,平,负,轮空,已赛场次,弃赛'];
    for (const r of rows) {
      lines.push([r.rank, csv(r.team.name), r.initialScore, r.score, r.aro, r.wins, r.draws, r.losses, r.byes, r.played, r.withdrawn ? '是' : ''].join(','));
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
