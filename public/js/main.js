// 应用主控：状态订阅(SSE) / 路由 / 顶栏步进器 / 撤销
import { api, toast } from './api.js';
import { $, $$ } from './ui.js';
import { renderSetup } from './views/setup.js';
import { renderSwiss } from './views/swiss.js';
import { renderKnockout } from './views/knockout.js';
import { renderBoard } from './views/board.js';

export const app = {
  d: null,          // /api/state 载荷
  route: 'setup',
  connected: false,
};

const VIEWS = { setup: renderSetup, swiss: renderSwiss, knockout: renderKnockout, board: renderBoard };

export function currentPhase(d) {
  if (!d.hasTournament) return 'setup';
  const k = d.state.knockout;
  if (k) {
    if (k.phase === 'done') return 'done';
    if (k.phase === 'final') return 'final';
    return 'knockout';
  }
  if (d.swissDone) return 'qualified';
  if (d.swissProgress.done === 0 && !d.pending) return 'enroll';
  return 'swiss';
}

function renderStepper(d) {
  const el = $('#stepper');
  const ph = currentPhase(d);
  // 步进器落位：车轮战属于「8强」阶段，决赛/颁奖各占一格
  const idxOf = { enroll: 0, swiss: 1, qualified: 2, knockout: 2, final: 3, done: 4 };
  const idx = idxOf[ph] ?? 0;
  const step = (name, at, extra = '', cls = '') => {
    const state = idx > at ? 'done' : idx === at ? 'on' : '';
    return `<div class="step ${state} ${cls}"><i class="dot"></i>${name}${extra}</div>`;
  };
  if (!d.hasTournament) { el.innerHTML = step('报名 / 建赛', 0, '', 'on'); return; }
  const done = d.swissProgress.done;
  const total = d.swissProgress.total;
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'f' : ''}"></i>`).join('');
  const swissExtra = `<span class="rnd">${dots}</span>`;
  el.innerHTML =
    step('报名', 0) +
    step('瑞士轮', 1, swissExtra) +
    step('8强', 2) +
    step('决赛', 3) +
    step('颁奖', 4);
}

function renderChrome(d) {
  document.getElementById('brand-name').textContent = d.hasTournament
    ? `${d.state.meta.name}`
    : 'DUBOV // 赛事系统';
  $('#brand-sub').textContent = d.hasTournament
    ? `瑞士轮 ${d.swissProgress.done}/${d.swissProgress.total} · ${d.state.teams.filter((t) => !t.withdrawn).length} 队在列`
    : 'STANDINGS · PAIRINGS · LIVE';
  const undoBtn = $('#btn-undo');
  undoBtn.hidden = !d.canUndo;
  undoBtn.textContent = d.undoLabel ? `↩ 撤销：${d.undoLabel}` : '↩ 撤销';
  $('#conn .led').className = `led ${app.connected ? 'led-on' : 'led-off'}`;
  $('#conn span').textContent = app.connected ? '实时同步' : '连接断开';
}

export function render() {
  const d = app.d;
  if (!d) return;
  renderChrome(d);
  renderStepper(d);
  document.body.classList.toggle('board-mode', app.route === 'board');
  $$('#rail a').forEach((a) => a.classList.toggle('on', a.dataset.route === app.route));
  const view = $('#view');
  VIEWS[app.route](view, d);
}

function guardRoute() {
  const d = app.d;
  // 无赛事时强制回设置页
  if (!d.hasTournament && app.route !== 'setup') {
    app.route = 'setup';
  }
}

async function handleState(payload) {
  app.d = payload;
  guardRoute();
  render();
}

function connectSSE() {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => {
    app.connected = true;
    handleState(JSON.parse(e.data));
  });
  es.onopen = () => { app.connected = true; if (app.d) render(); };
  es.onerror = () => {
    app.connected = false;
    if (app.d) render();
  };
}

// 路由
function applyHash() {
  const h = location.hash.replace(/^#\//, '') || 'setup';
  app.route = VIEWS[h] ? h : 'setup';
  if (app.d) { guardRoute(); render(); }
}
window.addEventListener('hashchange', applyHash);

// 撤销
$('#btn-undo').addEventListener('click', async () => {
  try {
    await api('POST', '/undo');
    toast('已撤销上一步操作');
  } catch { /* api 已 toast */ }
});

async function boot() {
  applyHash();
  try {
    const res = await fetch('/api/state');
    await handleState(await res.json());
  } catch {
    toast('无法连接服务端', true);
  }
  connectSSE();
}

boot();
