// 视图：瑞士轮 —— 对阵生成 / 结果录入 / 实时积分排名 / 轮次历史
import { api } from '../api.js';
import { can } from '../main.js';
import { esc, fmtAro, fmtPts, teamName, $ } from '../ui.js';
import { batchWindow, windowSummary } from '../schedule.js';

export function renderSwiss(el, d) {
  if (!d.hasTournament) {
    el.innerHTML = '<div class="panel corner"><div class="empty">请先在「赛前设置」中创建赛事</div></div>';
    return;
  }
  const k = d.state.knockout;
  const pending = d.pending;
  const done = d.swissProgress.done;
  const total = d.swissProgress.total;

  let left;
  if (k) {
    left = `
      <div class="panel corner">
        <div class="phead"><h2>瑞士轮已收官</h2><span class="sub">ARCHIVE</span></div>
        <p class="dim mb">全部 ${total} 轮已确认，淘汰赛进行中——对阵控制请前往「淘汰赛」页。</p>
        <a class="btn" href="#/knockout">前往淘汰赛 →</a>
      </div>`;
  } else if (pending) {
    left = pendingHtml(d, pending);
  } else if (done >= total) {
    left = `
      <div class="panel corner">
        <div class="phead"><h2>瑞士轮完成</h2><span class="sub">QUALIFICATION</span></div>
        <div class="banner">按「积分 → ARO」录取前 8 名进入淘汰赛（条款 5.2）。资格名单与防守方分配见「淘汰赛」页。</div>
        ${can('admin') ? '<a class="btn btn-primary btn-lg" href="#/knockout">前往淘汰赛 →</a>' : '<p class="hint">等待管理员进入淘汰赛。</p>'}
      </div>`;
  } else {
    left = `
      <div class="panel corner">
        <div class="phead"><h2>第 ${done + 1} 轮</h2><span class="sub">ROUND ${done + 1} / ${total}</span></div>
        <p class="dim mb">尚未生成对阵。程序按「积分分组 → 组内 ARO 升序折叠配对 → 奇数组上调级联 → 重复对位消解 → 批次随机」自动执行（条款 5.1 / 5.3.1 / 5.3.5）。</p>
        ${can('admin')
          ? `<button class="btn btn-primary btn-lg" id="gen-round">生成第 ${done + 1} 轮对阵</button>`
          : '<p class="hint">等待管理员生成对阵。</p>'}
      </div>`;
  }

  el.innerHTML = `
    <div class="swiss-grid">
      <div>${left}${historyHtml(d)}</div>
      <div>${standingsHtml(d)}</div>
    </div>`;
  bindSwiss(el, d);
}

function pendingHtml(d, p) {
  const promoted = new Set(p.promoted || []);
  const demoted = new Set(p.demoted || []);
  const resultsIn = p.pairings.every((x) => x.result);
  const canScore = can('referee');
  const pairs = p.pairings.map((x, i) => pairRow(d, x, promoted, demoted, i, canScore, p.round, p.pairings.length)).join('');
  const bye = p.bye ? `
    <div class="pairing" style="border-style:dashed">
      <div class="board-no">—</div>
      <div class="side left">
        <span class="nm">${esc(teamName(d, p.bye))} <span class="tag tag-bye">轮空</span></span>
        <span class="aro">本轮 ARO 项 = 除本组外对手均值 ${fmtAro(p.byeTerm ?? 0)}</span>
      </div>
      <span class="vs-sep">BYE</span>
      <div class="side right"><span class="aro">条款 5.3.1</span></div>
      <div></div>
    </div>` : '';
  const subForm = can('admin') ? subFormHtml(d) : '';

  return `
    <div class="panel corner">
      <div class="phead">
        <h2>第 ${p.round} 轮对阵</h2>
        <span class="sub">PAIRINGS · ${p.pairings.length} 台</span>
        <span class="sp">
          <a class="btn btn-sm" href="/round.html" target="_blank" title="渲染本轮对阵卡片（含批次时间窗），可导出图片 / 打印">⬒ 渲染导出</a>
          ${can('admin') ? '<button class="btn btn-sm" id="regen-round">重新生成</button>' : ''}
        </span>
      </div>
      <p class="hint" style="margin:0 0 10px">时间窗（第 ${Math.ceil(p.round / 2)} 天）：${windowSummary(p.round, p.pairings.length)}</p>
      ${p.warnings?.length ? `<div class="banner red">⚠ ${p.warnings.map(esc).join('<br>⚠ ')}</div>` : ''}
      ${bye}
      ${pairs}
      <div class="flex mt" style="margin-top:16px">
        ${canScore
          ? `<button class="btn btn-primary btn-lg" id="commit-round" ${resultsIn ? '' : 'disabled'}>确认本轮成绩，结算 ARO</button>
             <span class="hint">${resultsIn ? '全部对局已录入，确认后进入积分与 ARO 结算。' : '还有对局未录入结果。'}</span>`
          : '<span class="hint">结果由裁判录入；登录后可操作。</span>'}
      </div>
      ${subForm}
    </div>`;
}

// 5.3.7 补位替补：停赛/退赛致奇数时录入新队伍保证无轮空
function subFormHtml(d) {
  const next = d.nextRound || {};
  const activeCnt = next.activeCount ?? d.state.teams.filter((t) => !t.withdrawn && !t.suspended).length;
  const oddHint = activeCnt % 2 === 1
    ? '<span class="red">可赛队伍为奇数，未补位将按 5.3.1 轮空。</span>'
    : `<span class="dim">当前在赛 ${activeCnt} 队。</span>`;
  return `
    <div class="flex mt" style="margin-top:12px;gap:8px;align-items:center;border-top:1px dashed var(--line);padding-top:10px">
      <span class="hint">补位替补（5.3.7）：${oddHint}新队默认全负（0 分），初始 ARO 预填在赛队伍中位数，可改。</span>
      <input type="text" id="sub-name" placeholder="替补队伍名" style="max-width:150px">
      <input type="number" id="sub-score" value="${next.medianAro ?? 0}" min="0" max="999" step="0.001" style="max-width:95px" title="入场轮在赛队伍 ARO 中位数">
      <button class="btn btn-sm" id="sub-add">＋ 录入替补</button>
    </div>`;
}

function pairRow(d, p, promoted, demoted, i, canScore, roundNo, total) {
  const aWin = p.result === 'a';
  const bWin = p.result === 'b';
  const draw = p.result === 'draw';
  const isAdmin = can('admin');
  const rematched = !!p.rematchOf;
  const deferred = !!p.rematchDefer;
  const win = batchWindow(roundNo, p.board, total);
  let seg;
  if (canScore) {
    const rmBtn = (deferred || rematched) ? '' :
      `<button class="btn-reset" data-rematch-board="${p.board}" title="重赛：本轮立刻重赛，或登记下轮再重赛（管理员）">↺<i>重赛</i></button>`;
    // seg 与重赛键包进同一网格单元，避免挤占 .pairing 的五列布局
    seg = `
    <span class="segwrap">
      <span class="seg" data-board="${p.board}">
        <button class="${aWin ? 'on-a' : ''}" data-res="a" title="左边队伍胜">胜</button>
        <button class="${draw ? 'on-d' : ''}" data-res="draw">平</button>
        <button class="${bWin ? 'on-b' : ''}" data-res="b" title="右边队伍胜">胜</button>
      </span>${rmBtn}
    </span>`;
  } else {
    seg = `<span class="vs-sep">${aWin ? '1:0' : bWin ? '0:1' : draw ? '½:½' : 'VS'}</span>`;
  }
  // 5.3.7 停赛键：队伍名旁，管理员专属；重赛/暂记平局场次不提供
  const susp = (id) => (isAdmin && !deferred && !rematched
    ? `<button class="btn-susp" data-susp-team="${id}" title="停赛移除该队：本轮该场判对手胜，后续轮次不再参与（条款 5.3.7）">⏸</button>` : '');
  // 判负标记文案：涉停赛队 → 停赛判负，否则弃赛判负
  const woTag = (x) => {
    if (!x.walkover) return '';
    const tA = d.state.teams.find((t) => t.id === x.a);
    const tB = d.state.teams.find((t) => t.id === x.b);
    return `<span class="tag tag-out">${tA?.suspended || tB?.suspended ? '停赛判负' : '弃赛判负'}</span>`;
  };
  const flags = [
    rematched ? `<span class="tag tag-atk">重赛·第${p.rematchOf}轮</span>` : '',
    deferred ? '<span class="tag tag-bye">暂记平局·下轮重赛</span>' : '',
    woTag(p),
  ].join('');
  return `
    <div class="pairing row-anim ${aWin ? 'won-a' : bWin ? 'won-b' : ''}" style="animation-delay:${i * 40}ms">
      <div class="board-no">${String(p.board).padStart(2, '0')}<span class="bt">${win.day} ${win.time}</span></div>
      <div class="side left">
        <span class="nmrow"><span class="nm">${esc(teamName(d, p.a))}${promoted.has(p.a) ? ' <span class="tag tag-up">上调</span>' : ''}${demoted.has(p.a) ? ' <span class="tag tag-down">下调</span>' : ''}</span>${susp(p.a)}</span>
        <span class="aro">ARO ${fmtAro(p.aroA)}</span>
      </div>
      ${seg}
      <div class="side right">
        <span class="nmrow"><span class="nm">${demoted.has(p.b) ? '<span class="tag tag-down">下调</span> ' : ''}${promoted.has(p.b) ? '<span class="tag tag-up">上调</span> ' : ''}${esc(teamName(d, p.b))}</span>${susp(p.b)}</span>
        <span class="aro">ARO ${fmtAro(p.aroB)}</span>
      </div>
      <div class="flags">${flags}</div>
    </div>`;
}

// 排名表（board 视图复用）
export function standingsHtml(d, { big = false } = {}) {
  const rows = d.standings.filter((r) => !r.withdrawn && !r.suspended);
  const maxScore = Math.max(1, ...rows.map((r) => r.score));
  const trs = rows.map((r, i) => {
    const audit = r.terms.length
      ? r.terms.map((t) => `R${t.round}: ${t.opp ? teamName(d, t.opp) : '轮空'} AR.${fmtAro(t.R)} × ${t.k.toFixed(4)}`).join('\n')
      : '首轮入场：ARO = 中期考核分';
    const chipCls = r.rank === 1 ? 'rank-1' : r.rank === 2 ? 'rank-2' : r.rank === 3 ? 'rank-3' : '';
    return `
      <tr class="row-anim" style="animation-delay:${Math.min(i, 14) * 26}ms" title="${esc(audit)}">
        <td><span class="rank-chip ${chipCls}">${r.rank}</span></td>
        <td><span class="team-name"><span class="nm">${esc(r.team.name)}</span></span><div class="bar-wrap"><div class="bar-fill" style="width:${(r.score / maxScore) * 100}%"></div></div></td>
        <td class="num"><b>${fmtPts(r.score)}</b></td>
        <td class="num">${fmtAro(r.aro)}</td>
        <td class="num dim">${r.wins}-${r.draws}-${r.losses}${r.byes ? `+${r.byes}轮空` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div class="panel corner">
      <div class="phead"><h2>积分排名</h2><span class="sub">STANDINGS · LIVE</span><span class="sp"><i class="led led-live"></i></span></div>
      <table class="grid ${big ? 'board-table' : ''}">
        <thead><tr><th>名次</th><th>队伍</th><th class="num">积分</th><th class="num">ARO</th><th class="num">胜-平-负</th></tr></thead>
        <tbody>${trs || '<tr><td colspan="5" class="hint" style="text-align:center">暂无数据</td></tr>'}</tbody>
      </table>
      <p class="hint mt">排序：积分 → ARO（淘汰赛录取同序，条款 5.2）。悬停行可查看 ARO 逐轮账目。</p>
    </div>`;
}

function historyHtml(d) {
  const committed = d.state.swiss.rounds.filter((r) => r.committed);
  if (!committed.length) return '';
  const blocks = [...committed].reverse().map((r) => {
    const promoted = new Set(r.promoted || []);
    const demoted = new Set(r.demoted || []);
    const rows = r.pairings.map((p) => {
      const res = p.result === 'a' ? '1:0' : p.result === 'b' ? '0:1' : '½:½';
      const tA = d.state.teams.find((t) => t.id === p.a);
      const tB = d.state.teams.find((t) => t.id === p.b);
      const wo = p.walkover ? ` <span class="tag tag-out">${tA?.suspended || tB?.suspended ? '停赛判负' : '弃赛判负'}</span>` : '';
      const tags = `${p.rematchOf ? ' <span class="tag tag-atk">重赛·第' + p.rematchOf + '轮</span>' : ''}${p.rematchDefer ? ' <span class="tag tag-bye">暂记平局·下轮重赛</span>' : ''}${wo}`;
      return `<tr>
        <td class="num dim">${String(p.board).padStart(2, '0')}</td>
        <td>${esc(teamName(d, p.a))}${promoted.has(p.a) ? ' <span class="tag tag-up">上调</span>' : ''}</td>
        <td class="num ${p.result === 'a' ? 'amber' : p.result === 'b' ? 'cy' : 'dim'}">${res}${tags}</td>
        <td>${esc(teamName(d, p.b))}${promoted.has(p.b) ? ' <span class="tag tag-up">上调</span>' : ''}</td>
      </tr>`;
    }).join('');
    const byeRow = r.bye ? `<tr><td class="num dim">—</td><td colspan="3">${esc(teamName(d, r.bye))} <span class="tag tag-bye">轮空</span> <span class="hint">ARO 项 ${fmtAro(r.byeTerm ?? 0)}</span></td></tr>` : '';
    return `
      <details class="hist">
        <summary>第 ${r.round} 轮 · ${r.pairings.length} 台 · ${r.committedAt ? new Date(r.committedAt).toLocaleString('zh-CN', { hour12: false }) : ''}</summary>
        <div class="hist-body">
          <table class="grid">${rows}${byeRow}</table>
          ${(r.warnings?.length) ? `<p class="red mt" style="font-size:12px">⚠ ${r.warnings.map(esc).join('<br>⚠ ')}</p>` : ''}
        </div>
      </details>`;
  }).join('');
  return `
    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>轮次档案</h2><span class="sub">HISTORY</span></div>
      ${blocks}
    </div>`;
}

function bindSwiss(el, d) {
  const genBtn = $('#gen-round', el);
  if (genBtn) genBtn.addEventListener('click', async () => {
    await api('POST', '/swiss/generate');
    toast(`第 ${d.swissProgress.done + 1} 轮对阵已生成`);
  });

  const regenBtn = $('#regen-round', el);
  if (regenBtn) regenBtn.addEventListener('click', async () => {
    if (!confirm('重新生成将丢弃当前对阵及已录入结果（可撤销），继续？')) return;
    await api('POST', '/swiss/regenerate');
    toast('已重新生成对阵');
  });

  const commitBtn = $('#commit-round', el);
  if (commitBtn) commitBtn.addEventListener('click', async () => {
    await api('POST', '/swiss/commit');
    toast('本轮已确认，积分与 ARO 已结算');
  });

  // 覆盖式绑定：SSE 高频重渲染下避免监听器叠加
  el.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    // 5.3.6 重赛：管理员可选本轮立刻 / 下轮再重赛；裁判仅本轮立刻
    if (btn.dataset.rematchBoard) {
      const board = Number(btn.dataset.rematchBoard);
      const isAdmin = can('admin');
      let goDefer = false;
      if (isAdmin) {
        goDefer = !confirm(`第 ${board} 台重赛方式：\n\n【确定】本轮立刻重赛——清除已录结果，当场重打、重新录入\n【取消】改为「下轮再重赛」`);
        if (goDefer) {
          if (!confirm('确认「下轮再重赛」？\n\n本场本轮按平局结算（双方各 +1 分、ARO 项=对手 ARO）以保障赛程推进；下一轮生成对阵时该两队强制再次对位（豁免 5.3.5 禁止重复）。')) return;
        }
      } else {
        if (!confirm(`本轮立刻重赛？将清除第 ${board} 台已录结果，当场重打、重新录入。\n（「下轮再重赛」需管理员操作）`)) return;
      }
      if (goDefer) {
        await api('POST', '/swiss/defer-rematch', { board });
        toast(`第 ${board} 台已登记下轮重赛（本轮暂记平局）`);
      } else {
        await api('POST', '/swiss/results', { results: [{ board, result: 'reset' }] });
        toast(`第 ${board} 台结果已清除，可重新录入`);
      }
      return;
    }

    // 5.3.7 停赛：移除该队，本轮该场判对手胜
    if (btn.dataset.suspTeam) {
      const teamId = btn.dataset.suspTeam;
      const name = teamName(d, teamId);
      const activeCnt = (d.nextRound?.activeCount) ?? d.state.teams.filter((t) => !t.withdrawn && !t.suspended).length;
      const parity = activeCnt % 2 === 1 ? '\n· 停赛后可赛队伍为奇数，请用下方「补位替补」录入新队伍保证无轮空' : '';
      if (!confirm(`确认停赛「${name}」？（条款 5.3.7）\n\n· 本轮该场未录入的对局判对手胜（已录结果保留）\n· 后续所有轮次不再参与，历史成绩与 ARO 账目不变${parity}\n· 补位替补：默认全负（0 分），初始 ARO = 在赛队伍中位数`)) return;
      await api('POST', '/swiss/suspend', { teamId });
      toast(`「${name}」已停赛移除，本轮该场判对手胜`);
      return;
    }

    if (btn.id === 'sub-add') {
      const name = $('#sub-name', el).value.trim();
      if (!name) { toast('请输入替补队伍名', true); return; }
      const initialScore = Number($('#sub-score', el).value) || 0;
      await api('POST', '/teams', { teams: [{ name, initialScore }] });
      toast(`替补「${name}」已录入（初始 ARO ${initialScore}），下轮参赛`);
      return;
    }

    const seg = btn.closest('.seg');
    if (!seg) return;
    await api('POST', '/swiss/results', { results: [{ board: Number(seg.dataset.board), result: btn.dataset.res }] });
  };
}
