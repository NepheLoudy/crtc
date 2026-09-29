'use strict';
// REST API + SSE 实时推送
import express from 'express';
import * as store from './store.js';
import {
  newTournament, addTeams, updateTeam, removeTeam, withdrawTeam, reinstateTeam,
  generateRound, submitResults, commitRound, regenerateRound,
  pendingRound, committedRounds, standings, computeTable,
} from '../lib/engine.js';
import {
  initKnockout, assignAttackers, playGame, recordFinalGame, knockoutRanking,
  withdrawFromKnockout, settleWalkover,
} from '../lib/knockout.js';

const sseClients = new Set();

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(view())}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* 客户端断开由 close 统一清理 */ }
  }
}

// 面向前端的单一视图载荷：状态 + 派生数据一次给全
function view() {
  const state = store.get();
  if (!state) return { hasTournament: false, canUndo: store.canUndo(), serverTime: Date.now() };
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
    serverTime: Date.now(),
  };
}

function wrap(label, fn) {
  return (req, res) => {
    try {
      store.snapshot(label);
      const result = fn(req) ?? {};
      store.save();
      broadcast();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  };
}

export function createApiRouter() {
  const api = express.Router();

  api.get('/state', (req, res) => res.json(view()));

  api.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify(view())}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  });

  // ---- 赛事 ----
  api.post('/tournament', wrap('创建赛事', (req) => {
    if (store.get()) throw new Error('已存在赛事，请先在设置页销毁重建');
    const { name, totalRounds, settings, teams } = req.body || {};
    const state = newTournament({ name, totalRounds, settings, teams });
    store.set(state);
  }));

  api.post('/tournament/reset', wrap('销毁赛事', () => {
    store.set(null);
  }));

  api.put('/settings', wrap('修改设置', (req) => {
    const state = store.get();
    if (!state) throw new Error('尚未创建赛事');
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

  // 撤销：不能走 wrap（否则会先把当前状态压栈、又立刻被自己弹出）
  api.post('/undo', (req, res) => {
    try {
      const label = store.undo();
      store.save();
      broadcast();
      res.json({ ok: true, label });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ---- 队伍 ----
  api.post('/teams', wrap('添加队伍', (req) => {
    const state = store.get();
    if (!state) throw new Error('尚未创建赛事');
    const added = addTeams(state, req.body?.teams || []);
    if (!added.length) throw new Error('没有有效的队伍数据');
  }));

  api.put('/teams/:id', wrap('修改队伍', (req) => {
    const state = store.get();
    if (!state) throw new Error('尚未创建赛事');
    updateTeam(state, req.params.id, req.body || {});
  }));

  api.delete('/teams/:id', wrap('删除队伍', (req) => {
    removeTeam(store.get(), req.params.id);
  }));

  // 退赛统一入口：瑞士轮阶段走 engine（本轮场次转人工结算），
  // 淘汰赛阶段走继承算法（防守方由队列队首继承）
  api.post('/teams/:id/withdraw', wrap('队伍退赛', (req) => {
    const state = store.get();
    if (!state) throw new Error('尚未创建赛事');
    const k = state.knockout;
    if (k && ['assign', 'battle', 'final'].includes(k.phase)) {
      withdrawFromKnockout(state, req.params.id);
    } else {
      withdrawTeam(state, req.params.id, { midRound: req.body?.midRound !== false });
    }
  }));

  api.post('/teams/:id/reinstate', wrap('队伍恢复', (req) => {
    reinstateTeam(store.get(), req.params.id);
  }));

  // ---- 瑞士轮 ----
  api.post('/swiss/generate', wrap('生成对阵', () => {
    generateRound(store.get());
  }));

  api.post('/swiss/regenerate', wrap('重新生成对阵', () => {
    regenerateRound(store.get());
  }));

  api.post('/swiss/results', wrap('录入结果', (req) => {
    submitResults(store.get(), req.body?.results || []);
  }));

  api.post('/swiss/commit', wrap('确认本轮', () => {
    commitRound(store.get());
  }));

  // ---- 淘汰赛 ----
  api.post('/knockout/init', wrap('录取8强', () => {
    initKnockout(store.get());
  }));

  api.post('/knockout/assign', wrap('编组进攻队列', (req) => {
    assignAttackers(store.get(), req.body?.assignment || {});
  }));

  api.post('/knockout/game', wrap('录入对局', (req) => {
    playGame(store.get(), req.body?.group, req.body?.outcome);
  }));

  api.post('/knockout/walkover', wrap('补判弃赛场', (req) => {
    settleWalkover(store.get(), req.body?.group);
  }));

  api.post('/knockout/final', wrap('录入决赛对局', (req) => {
    recordFinalGame(store.get(), req.body?.outcome);
  }));

  // ---- 导出 ----
  api.get('/export/json', (req, res) => {
    const state = store.get();
    if (!state) return res.status(404).json({ ok: false, error: '尚未创建赛事' });
    res.set('Content-Disposition', 'attachment; filename="tournament.json"');
    res.json(view());
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
