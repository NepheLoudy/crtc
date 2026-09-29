// 视图：排名大屏（只读自动跟随赛程阶段，SSE 实时刷新）
import { esc, fmtAro, fmtPts, teamName } from '../ui.js';
import { standingsHtml } from './swiss.js';
import { consoleHtml, finalHtml } from './knockout.js';

export function renderBoard(el, d) {
  if (!d.hasTournament) {
    el.innerHTML = '<div class="panel corner"><div class="empty">WAITING FOR TOURNAMENT — 请在控制端创建赛事</div></div>';
    return;
  }
  const k = d.state.knockout;
  const phaseTag = !k
    ? (d.swissDone ? '瑞士轮收官 · 待录取8强' : d.pending ? `瑞士轮 第${d.pending.round}轮 · 对局进行中` : `瑞士轮 第${d.swissProgress.done + 1}轮 · 待开局`)
    : k.phase === 'assign' ? '淘汰赛 · 志愿编组'
      : k.phase === 'battle' ? '淘汰赛 · 车轮战进行中'
        : k.phase === 'final' ? '总决赛' : '颁奖典礼';

  el.innerHTML = `
    <div class="board-head">
      <div>
        <div class="big-name">${esc(d.state.meta.name)} <span class="thin">// LIVE</span></div>
      </div>
      <span class="phase-tag">${phaseTag}</span>
      <span class="clock" id="board-clock"></span>
    </div>
    ${boardBody(d, k)}
  `;

  const tick = () => {
    const c = document.getElementById('board-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  };
  tick();
  clearInterval(renderBoard._clk);
  renderBoard._clk = setInterval(tick, 1000);
}

function boardBody(d, k) {
  if (!k) {
    const pending = d.pending;
    const pairsPanel = pending ? `
      <div class="panel corner">
        <div class="phead"><h2>第 ${pending.round} 轮对阵</h2><span class="sub">PAIRINGS</span></div>
        ${pending.pairings.map((p, i) => `
          <div class="pairing row-anim" style="animation-delay:${i * 50}ms;${p.result ? '' : 'opacity:.75'}">
            <div class="board-no">${String(p.board).padStart(2, '0')}</div>
            <div class="side left"><span class="nm" style="${p.result === 'a' ? 'color:var(--amber)' : ''}">${esc(teamName(d, p.a))}</span><span class="aro">ARO ${fmtAro(p.aroA)}</span></div>
            <span class="vs-sep">${p.result === 'a' ? '1:0' : p.result === 'b' ? '0:1' : p.result === 'draw' ? '½:½' : 'VS'}</span>
            <div class="side right"><span class="nm" style="${p.result === 'b' ? 'color:var(--cyan)' : ''}">${esc(teamName(d, p.b))}</span><span class="aro">ARO ${fmtAro(p.aroB)}</span></div>
            <div></div>
          </div>`).join('')}
        ${pending.bye ? `<p class="hint mt">轮空：${esc(teamName(d, pending.bye))}</p>` : ''}
      </div>` : '';
    return `<div class="board-grid">${standingsHtml(d, { big: true })}${pairsPanel || placeholderPanel('等待第 1 轮对阵生成')}</div>`;
  }
  if (k.phase === 'assign') {
    return `<div class="board-grid">${qualifyTable(d, k)}${placeholderPanel('进攻组别志愿分配中…')}</div>`;
  }
  if (k.phase === 'battle' || k.phase === 'final') {
    const elim = k.eliminated.length ? `
      <div class="panel corner">
        <div class="phead"><h2>已出局</h2><span class="sub">ELIMINATED · ${k.eliminated.length}</span></div>
        <div class="flex">${[...k.eliminated].reverse().map((e) => `<span class="tag tag-out">${esc(teamName(d, e.id))}</span>`).join('')}</div>
      </div>` : '';
    return `
      <div class="ko-grid">${consoleHtml(d, k, 'A', true)}${consoleHtml(d, k, 'B', true)}</div>
      ${k.phase === 'final' ? `<div style="margin-top:18px">${finalHtml(d, k, true)}</div>` : ''}
      <div style="margin-top:18px">${elim}</div>`;
  }
  // done：领奖台 + 最终名次
  const ranking = d.knockoutRanking || [];
  const [p1, p2, p3] = ranking;
  const podium = p3 ? `
    <div class="podium">
      <div class="pod p2"><div class="medal">亚军</div><div class="nm">${esc(p2.name)}</div><div class="meta">胜 ${p2.matchWins} · ${fmtPts(p2.pts)} 分</div></div>
      <div class="pod p1"><div class="medal">★ 冠军 ★</div><div class="nm">${esc(p1.name)}</div><div class="meta">胜 ${p1.matchWins} · ${fmtPts(p1.pts)} 分</div></div>
      <div class="pod p3"><div class="medal">季军</div><div class="nm">${esc(p3.name)}</div><div class="meta">胜 ${p3.matchWins} · ${fmtPts(p3.pts)} 分</div></div>
    </div>` : '';
  const rows = ranking.map((r) => `
    <tr class="row-anim" style="animation-delay:${Math.min(r.finalRank, 12) * 30}ms">
      <td><span class="rank-chip ${r.finalRank === 1 ? 'rank-1' : r.finalRank === 2 ? 'rank-2' : r.finalRank === 3 ? 'rank-3' : ''}">${r.finalRank}</span></td>
      <td>${esc(r.name)}</td>
      <td class="num">${r.matchWins}</td>
      <td class="num">${fmtPts(r.pts)}</td>
      <td class="num dim">${fmtAro(r.swissAro)}</td>
    </tr>`).join('');
  return `
    ${podium}
    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>最终名次</h2><span class="sub">FINAL STANDING</span></div>
      <table class="grid board-table">
        <thead><tr><th>名次</th><th>队伍</th><th class="num">车轮战胜场</th><th class="num">总积分</th><th class="num">瑞士轮ARO</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function qualifyTable(d, k) {
  const nm = (id) => teamName(d, id);
  const rows = k.order.map((id, i) => `
    <tr class="row-anim" style="animation-delay:${i * 30}ms">
      <td><span class="rank-chip ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : ''}">${i + 1}</span></td>
      <td>${esc(nm(id))}</td>
      <td class="num dim">${fmtAro(d.standings.find((r) => r.teamId === id)?.aro ?? 0)}</td>
      <td>${i < 2 ? `<span class="tag tag-def">${i === 0 ? 'A' : 'B'} 组防守方</span>` : '<span class="tag tag-atk">进攻方</span>'}</td>
    </tr>`).join('');
  return `
    <div class="panel corner">
      <div class="phead"><h2>8 强名单</h2><span class="sub">QUALIFIED</span></div>
      <table class="grid board-table">
        <thead><tr><th>顺位</th><th>队伍</th><th class="num">ARO</th><th>角色</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function placeholderPanel(text) {
  return `<div class="panel corner"><div class="empty">${esc(text)}</div></div>`;
}
