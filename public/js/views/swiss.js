// 视图：瑞士轮 —— 对阵生成 / 结果录入 / 实时积分排名 / 轮次历史
import { api } from '../api.js';
import { esc, fmtAro, fmtPts, teamName, $ } from '../ui.js';

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
        <a class="btn btn-primary btn-lg" href="#/knockout">前往淘汰赛 →</a>
      </div>`;
  } else {
    left = `
      <div class="panel corner">
        <div class="phead"><h2>第 ${done + 1} 轮</h2><span class="sub">ROUND ${done + 1} / ${total}</span></div>
        <p class="dim mb">尚未生成对阵。程序按「积分分组 → 组内 ARO 升序折叠配对 → 奇数组上调级联 → 重复对位消解 → 批次随机」自动执行（条款 5.1 / 5.3.1 / 5.3.5）。</p>
        <button class="btn btn-primary btn-lg" id="gen-round">生成第 ${done + 1} 轮对阵</button>
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
  const pairs = p.pairings.map((x, i) => pairRow(d, x, promoted, demoted, i)).join('');
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

  return `
    <div class="panel corner">
      <div class="phead">
        <h2>第 ${p.round} 轮对阵</h2>
        <span class="sub">PAIRINGS · ${p.pairings.length} 台</span>
        <span class="sp">
          <button class="btn btn-sm" id="regen-round">重新生成</button>
        </span>
      </div>
      ${p.warnings?.length ? `<div class="banner red">⚠ ${p.warnings.map(esc).join('<br>⚠ ')}</div>` : ''}
      ${bye}
      ${pairs}
      <div class="flex mt" style="margin-top:16px">
        <button class="btn btn-primary btn-lg" id="commit-round" ${resultsIn ? '' : 'disabled'}>确认本轮成绩，结算 ARO</button>
        <span class="hint">${resultsIn ? '全部对局已录入，确认后进入积分与 ARO 结算。' : '还有对局未录入结果。'}</span>
      </div>
    </div>`;
}

function pairRow(d, p, promoted, demoted, i) {
  const aWin = p.result === 'a';
  const bWin = p.result === 'b';
  const draw = p.result === 'draw';
  const seg = `
    <span class="seg" data-board="${p.board}">
      <button class="${aWin ? 'on-a' : ''}" data-res="a" title="左边队伍胜">胜</button>
      <button class="${draw ? 'on-d' : ''}" data-res="draw">平</button>
      <button class="${bWin ? 'on-b' : ''}" data-res="b" title="右边队伍胜">胜</button>
    </span>`;
  return `
    <div class="pairing row-anim ${aWin ? 'won-a' : bWin ? 'won-b' : ''}" style="animation-delay:${i * 40}ms">
      <div class="board-no">${String(p.board).padStart(2, '0')}</div>
      <div class="side left">
        <span class="nm">${esc(teamName(d, p.a))}${promoted.has(p.a) ? ' <span class="tag tag-up">上调</span>' : ''}${demoted.has(p.a) ? ' <span class="tag tag-down">下调</span>' : ''}</span>
        <span class="aro">ARO ${fmtAro(p.aroA)}</span>
      </div>
      ${seg}
      <div class="side right">
        <span class="nm">${demoted.has(p.b) ? '<span class="tag tag-down">下调</span> ' : ''}${promoted.has(p.b) ? '<span class="tag tag-up">上调</span> ' : ''}${esc(teamName(d, p.b))}</span>
        <span class="aro">ARO ${fmtAro(p.aroB)}</span>
      </div>
      <div class="flags">${p.oppWithdrawn ? '<span class="tag tag-out">对方弃赛 · 待人工结算</span>' : ''}</div>
    </div>`;
}

// 排名表（board 视图复用）
export function standingsHtml(d, { big = false } = {}) {
  const rows = d.standings.filter((r) => !r.withdrawn);
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
      return `<tr>
        <td class="num dim">${String(p.board).padStart(2, '0')}</td>
        <td>${esc(teamName(d, p.a))}${promoted.has(p.a) ? ' <span class="tag tag-up">上调</span>' : ''}</td>
        <td class="num ${p.result === 'a' ? 'amber' : p.result === 'b' ? 'cy' : 'dim'}">${res}${p.oppWithdrawn ? ' <span class="tag tag-out">弃赛</span>' : ''}</td>
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
    const btn = e.target.closest('.seg button');
    if (!btn) return;
    const seg = btn.closest('.seg');
    await api('POST', '/swiss/results', { results: [{ board: Number(seg.dataset.board), result: btn.dataset.res }] });
  };
}
