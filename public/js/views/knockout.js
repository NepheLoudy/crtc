// 视图：淘汰赛 —— 8强录取 / 志愿编组 / 车轮战控制台 / 决赛与颁奖
import { api } from '../api.js';
import { can } from '../main.js';
import { esc, fmtAro, fmtPts, teamName, $ } from '../ui.js';

let assignMap = {}; // 志愿分配暂存 teamId → 'A'|'B'

export function renderKnockout(el, d) {
  if (!d.hasTournament) {
    el.innerHTML = '<div class="panel corner"><div class="empty">请先在「赛前设置」中创建赛事</div></div>';
    return;
  }
  const k = d.state.knockout;
  if (!k) {
    el.innerHTML = preKnockoutHtml(d);
    bindPre(el, d);
    return;
  }
  if (k.phase === 'assign') {
    if (!can('admin')) {
      el.innerHTML = '<div class="panel corner"><div class="phead"><h2>志愿分配</h2></div><div class="empty">进攻组别编组由管理员操作 — 当前为只读视图</div></div>';
      return;
    }
    if (assignPhaseOf(k) !== assignMap.__phase) assignMap = { __phase: assignPhaseOf(k) };
    el.innerHTML = assignHtml(d, k);
    bindAssign(el, d, k);
    return;
  }
  if (k.phase === 'battle' || k.phase === 'final') {
    el.innerHTML = battleHtml(d, k);
    bindBattle(el, d);
    return;
  }
  // done
  el.innerHTML = doneHtml(d, k);
}

const assignPhaseOf = (k) => k.order.join(',');

function preKnockoutHtml(d) {
  if (!d.swissDone) {
    return `<div class="panel corner">
      <div class="phead"><h2>淘汰赛</h2><span class="sub">KNOCKOUT · LOCKED</span></div>
      <div class="banner">瑞士轮尚未完成（${d.swissProgress.done}/${d.swissProgress.total}）。完成全部轮次后此处将开放 8 强录取。</div>
      <a class="btn" href="#/swiss">返回瑞士轮 →</a>
    </div>`;
  }
  const top8 = d.standings.filter((r) => !r.withdrawn).slice(0, 8);
  const rows = top8.map((r, i) => `
    <tr class="row-anim" style="animation-delay:${i * 26}ms">
      <td><span class="rank-chip ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''}">${i + 1}</span></td>
      <td>${esc(r.team.name)}</td>
      <td class="num"><b>${fmtPts(r.score)}</b></td>
      <td class="num">${fmtAro(r.aro)}</td>
      <td class="dim">${i < 2 ? '防守方（ARO 前二）' : '进攻方'}</td>
    </tr>`).join('');
  return `
    <div class="panel corner">
      <div class="phead"><h2>8 强录取</h2><span class="sub">QUALIFICATION · 条款 5.2</span></div>
      <div class="banner">录取前 8 名后：ARO 最高与次高自动成为 A / B 组防守方（初始 ${d.state.settings.defenderStart} 分，上限 ${d.state.settings.defenderCap}）；其余 6 队按 ARO 顺序志愿选择进攻组别（初始 ${d.state.settings.attackerStart} 分）。</div>
      <table class="grid">
        <thead><tr><th>名次</th><th>队伍</th><th class="num">积分</th><th class="num">ARO</th><th>角色</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="mt" style="margin-top:16px">
        ${can('admin')
          ? '<button class="btn btn-primary btn-lg" id="ko-init">确认录取，进入淘汰赛</button>'
          : '<p class="hint">录取由管理员操作。</p>'}
      </div>
    </div>`;
}

function bindPre(el, d) {
  const btn = $('#ko-init', el);
  if (btn) btn.addEventListener('click', async () => {
    if (!confirm('录取前 8 名进入淘汰赛？录取后瑞士轮阶段将锁定。')) return;
    await api('POST', '/knockout/init');
    toast('8 强已录取，请完成进攻组别志愿分配');
  });
}

function assignHtml(d, k) {
  const nm = (id) => teamName(d, id);
  const attackers = k.order.slice(2);
  const attackersInOrder = attackers.map((id) => `
    <div class="q-item def-q" style="border-left-color:var(--line-strong)">
      <span class="mono dim">${fmtAro(d.standings.find((r) => r.teamId === id)?.aro ?? 0)}</span>
      <span class="grow">${esc(nm(id))}</span>
      <span class="seg" data-team="${id}">
        <button class="${assignMap[id] === 'A' ? 'on-a' : ''}" data-g="A">A 组</button>
        <button class="${assignMap[id] === 'B' ? 'on-b' : ''}" data-g="B">B 组</button>
      </span>
    </div>`).join('');
  const col = (g) => {
    const def = k.groups[g].defender;
    const members = attackers.filter((id) => assignMap[id] === g);
    return `
      <div class="panel corner">
        <div class="phead"><h2>${g} 组</h2><span class="sub">${g === 'A' ? 'ARO 最高' : 'ARO 次高'} 为防守方</span></div>
        <div class="fighter def">
          <span class="role">◆ 防守方 DEFENDER</span>
          <span class="nm">${esc(nm(def))}</span>
          <span class="pts">${fmtPts(k.pts[def])} <small>初始积分</small></span>
        </div>
        <div class="queue">
          <div class="q-head">进攻队列（${members.length} 队 · 按志愿顺序）</div>
          ${members.map((id) => `<div class="q-item"><span class="grow">${esc(nm(id))}</span><span class="q-pts">${fmtPts(k.pts[id])}</span></div>`).join('') || '<p class="hint">尚无队伍选择本组</p>'}
        </div>
      </div>`;
  };
  const allAssigned = attackers.every((id) => assignMap[id] === 'A' || assignMap[id] === 'B');
  return `
    <div class="panel corner mb">
      <div class="phead"><h2>进攻组别志愿分配</h2><span class="sub">VOLUNTEER · 条款 5.2</span></div>
      <div class="banner cy">以下 6 支队伍按 <b>ARO 从高到低</b> 排列（志愿顺位）。请依次为每队选择期望的进攻组别；同组内按此顺序排成进攻队列，车轮战迎战防守方。</div>
      ${attackersInOrder}
      <div class="flex" style="margin-top:16px">
        <button class="btn" id="auto-assign">自动均分（交替分配）</button>
        <button class="btn btn-primary" id="confirm-assign" ${allAssigned ? '' : 'disabled'}>确认编组，开始车轮战</button>
        <span class="hint">${allAssigned ? '就绪。' : '为全部队伍选择组别后可确认。'}</span>
      </div>
    </div>
    <div class="ko-grid">${col('A')}${col('B')}</div>`;
}

function bindAssign(el, d, k) {
  // 覆盖式绑定：SSE 高频重渲染下避免监听器叠加
  el.onclick = (e) => {
    const btn = e.target.closest('.seg[data-team] button');
    if (btn) {
      assignMap[btn.closest('.seg').dataset.team] = btn.dataset.g;
      renderKnockout(el, d);
      return;
    }
    if (e.target.id === 'auto-assign') {
      k.order.slice(2).forEach((id, i) => { assignMap[id] = i % 2 === 0 ? 'A' : 'B'; });
      renderKnockout(el, d);
      return;
    }
    if (e.target.id === 'confirm-assign') {
      const assignment = {};
      k.order.slice(2).forEach((id) => { assignment[id] = assignMap[id]; });
      api('POST', '/knockout/assign', { assignment })
        .then(() => toast('编组完成，车轮战开始！'))
        .catch(() => {});
    }
  };
}

function battleHtml(d, k) {
  const ro = !can('referee'); // 未登录观众只读；裁判及以上可录入
  const consoles = ['A', 'B'].map((g) => consoleHtml(d, k, g, ro)).join('');
  const finalCard = k.phase === 'final' ? finalHtml(d, k, ro) : '';
  const extra = k.phase === 'final'
    ? `<div class="banner">场上仅剩两支防守方 —— 决赛开始（BO3，先胜 2 局者夺冠）。</div>`
    : '';
  return `
    ${extra}
    <div class="ko-grid">${consoles}</div>
    ${finalCard}
    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>战况日志</h2><span class="sub">BATTLE LOG</span></div>
      <div class="log-feed">${[...k.log].reverse().map(logLine).join('') || '<p class="hint">暂无记录</p>'}</div>
    </div>`;
}

// 控制台卡片（board 大屏复用；ro=true 只读，不渲染操作按钮）
export function consoleHtml(d, k, g, ro = false) {
  const cur = k.current[g];
  const grp = k.groups[g];
  const nm = (id) => teamName(d, id);
  const eliminatedIds = new Set(k.eliminated.map((e) => e.id));
  const aliveQueue = grp.queue.filter((id) => !eliminatedIds.has(id));
  // 退赛小按钮（仅管理员）：标记后规则自动推进
  const kick = (id) => (ro || !can('admin')) ? '' :
    `<button class="btn btn-sm btn-danger" data-kick="${id}" title="标记退赛：当前场次判负并正常结算">✕</button>`;

  const duel = cur ? `
    <div class="duel">
      <div class="fighter def">
        <span class="role">◆ 防守方 ${ro ? '' : kick(cur.defender)}</span>
        <span class="nm">${esc(nm(cur.defender))}</span>
        <span class="pts">${fmtPts(k.pts[cur.defender])}<small> 分</small></span>
      </div>
      <div class="mid">
        <span class="match-no">第 ${k.matchCounter + 1} 场</span>
        <div class="pips">${cur.games.map((x) => `<i class="pip ${x === 'defender' ? 'd' : x === 'attacker' ? 'a' : 'x'}" title="${x === 'defender' ? '防守方胜' : x === 'attacker' ? '进攻方胜' : '平局'}"></i>`).join('') || '<i class="pip"></i>'}</div>
        <span class="match-no dim">BO3 · 先胜2局</span>
      </div>
      <div class="fighter atk">
        <span class="role">▲ 进攻方 ${ro ? '' : kick(cur.attacker)}</span>
        <span class="nm">${esc(nm(cur.attacker))}</span>
        <span class="pts">${fmtPts(k.pts[cur.attacker])}<small> 分</small></span>
      </div>
    </div>
    <div class="flex" style="justify-content:center">
      ${ro ? '' : `
      <span class="seg" data-group="${g}">
        <button data-outcome="defender"><span class="amber">◆ 防守胜</span></button>
        <button data-outcome="draw">平局</button>
        <button data-outcome="attacker"><span class="cy">进攻胜 ▲</span></button>
      </span>`}
    </div>`
    : `<div class="empty">${grp.defender ? `${g} 组进攻队列已空 —— ${esc(nm(grp.defender))} 驻守待命` : `${g} 组防守空缺`}</div>`;

  const queue = aliveQueue.map((id) => `
    <div class="q-item"><span class="grow">${esc(nm(id))}</span><span class="q-pts">${fmtPts(k.pts[id])}</span>${ro ? '' : kick(id)}</div>`).join('');

  return `
    <div class="panel corner">
      <div class="phead"><h2>${g} 组防线</h2><span class="sub">GROUP ${g}</span></div>
      ${duel}
      <div class="queue">
        <div class="q-head">进攻队列 · ${aliveQueue.length} 队待战</div>
        ${queue || '<p class="hint">队列已空</p>'}
      </div>
    </div>`;
}

// 决赛卡片（board 大屏复用；ro=true 只读）
export function finalHtml(d, k, ro = false) {
  const kickFinal = (id) => (ro || !can('admin')) ? '' :
    `<button class="btn btn-sm btn-danger" data-kick="${id}" title="决赛退赛：对手夺冠">✕</button>`;
  const [a, b] = k.final.players;
  const aWins = k.final.games.filter((x) => x === 'a').length;
  const bWins = k.final.games.filter((x) => x === 'b').length;
  return `
    <div class="panel corner" style="margin-top:18px;border-color:rgba(255,210,122,.5)">
      <div class="phead"><h2>决赛</h2><span class="sub">GRAND FINAL · BO3</span></div>
      <div class="duel">
        <div class="fighter def">
          <span class="role">◆ ${esc(teamName(d, a))} ${ro ? '' : kickFinal(a)}</span>
          <span class="nm">局分 ${aWins}</span>
          <span class="pts">${fmtPts(k.pts[a])}<small> 积分</small></span>
        </div>
        <div class="mid">
          <span class="match-no amber">CHAMPION MATCH</span>
          <div class="pips">${k.final.games.map((x) => `<i class="pip ${x === 'a' ? 'd' : x === 'b' ? 'a' : 'x'}"></i>`).join('') || '<i class="pip"></i>'}</div>
          <span class="match-no dim">先胜 2 局</span>
        </div>
        <div class="fighter atk">
          <span class="role">▲ ${esc(teamName(d, b))} ${ro ? '' : kickFinal(b)}</span>
          <span class="nm">局分 ${bWins}</span>
          <span class="pts">${fmtPts(k.pts[b])}<small> 积分</small></span>
        </div>
      </div>
      <div class="flex" style="justify-content:center">
        ${ro ? '' : `
        <span class="seg" data-final="1">
          <button data-outcome="a">${esc(teamName(d, a))} 胜</button>
          <button data-outcome="draw">平局</button>
          <button data-outcome="b">${esc(teamName(d, b))} 胜</button>
        </span>`}
      </div>
    </div>`;
}

function logLine(lg) {
  const cls = lg.eliminated ? 'elim' : lg.swap ? 'swap' : lg.winner ? 'hold' : '';
  const t = new Date(lg.ts).toLocaleTimeString('zh-CN', { hour12: false });
  return `<div class="lg ${cls}"><span class="dim">${t}</span> — <b>${esc(lg.msg)}</b></div>`;
}

function doneHtml(d, k) {
  const ranking = d.knockoutRanking || [];
  const p1 = ranking.find((r) => r.finalRank === 1);
  const p2 = ranking.find((r) => r.finalRank === 2);
  const p3 = ranking.find((r) => r.finalRank === 3);
  const podium = p1 ? `
    <div class="podium">
      ${p2 ? `<div class="pod p2"><div class="medal">亚军 · RUNNER-UP</div><div class="nm">${esc(p2.name)}</div><div class="meta">车轮胜 ${p2.matchWins} · 积分 ${fmtPts(p2.pts)}</div></div>` : '<div></div>'}
      <div class="pod p1"><div class="medal">★ 冠军 · CHAMPION ★</div><div class="nm">${esc(p1.name)}</div><div class="meta">车轮胜 ${p1.matchWins} · 积分 ${fmtPts(p1.pts)}</div></div>
      ${p3 ? `<div class="pod p3"><div class="medal">季军 · THIRD</div><div class="nm">${esc(p3.name)}</div><div class="meta">车轮胜 ${p3.matchWins} · 积分 ${fmtPts(p3.pts)}</div></div>` : '<div></div>'}
    </div>` : '';
  const rows = ranking.map((r) => `
    <tr class="row-anim" style="animation-delay:${r.finalRank * 30}ms">
      <td><span class="rank-chip ${r.finalRank === 1 ? 'rank-1' : r.finalRank === 2 ? 'rank-2' : r.finalRank === 3 ? 'rank-3' : ''}">${r.finalRank}</span>
      ${r.finalRank === 1 ? '<span class="tag tag-champ">冠军</span>' : ''}</td>
      <td>${esc(r.name)}</td>
      <td class="num">${r.matchWins}</td>
      <td class="num">${fmtPts(r.pts)}</td>
      <td class="num">${fmtAro(r.swissAro)}</td>
      <td class="num dim">${fmtPts(r.swissScore)}</td>
    </tr>`).join('');
  return `
    ${podium}
    <div class="panel corner">
      <div class="phead"><h2>最终名次</h2><span class="sub">FINAL STANDING · 条款 5.2 季军裁定</span></div>
      <table class="grid">
        <thead><tr><th>名次</th><th>队伍</th><th class="num">车轮战胜场</th><th class="num">总积分</th><th class="num">瑞士轮ARO</th><th class="num">瑞士轮积分</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint mt">3~8 名按「车轮战胜场 → 总积分 → 瑞士轮 ARO」三级裁定。</p>
      <div class="flex mt">
        <a class="btn" href="/api/export/standings.csv" download>导出成绩 CSV</a>
        <a class="btn" href="#/board">大屏展示 →</a>
      </div>
    </div>
    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>战况日志</h2><span class="sub">BATTLE LOG</span></div>
      <div class="log-feed">${[...k.log].reverse().map(logLine).join('')}</div>
    </div>`;
}

function bindBattle(el, d) {
  // 覆盖式绑定：SSE 高频重渲染下避免监听器叠加
  el.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const seg = btn.closest('.seg');
    if (btn.dataset.kick) {
      const name = teamName(d, btn.dataset.kick);
      if (!confirm(`确认「${name}」退赛？\n\n规则自动推进：正在进行的场次直接判负并正常结算（防守方退赛则进攻方破防接任），退赛者不再回队列；决赛退赛则对手夺冠。`)) return;
      api('POST', `/teams/${btn.dataset.kick}/withdraw`, { midRound: true })
        .then(() => toast(`「${name}」已退赛，判负结算完成`))
        .catch(() => {});
    } else if (seg?.dataset.group) {
      api('POST', '/knockout/game', { group: seg.dataset.group, outcome: btn.dataset.outcome }).catch(() => {});
    } else if (seg?.dataset.final) {
      api('POST', '/knockout/final', { outcome: btn.dataset.outcome }).catch(() => {});
    }
  };
}
