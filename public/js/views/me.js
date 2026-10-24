// 视图：我的比赛 —— 队员专属（登录后可见）
// 查看：本队信息 / 本轮对阵 / 排名 / 我的申请
// 操作：提出弃赛申请、场次调换申请（管理员批准后生效，队员不直接改状态）
import { api, toast } from '../api.js';
import { app, can } from '../main.js';
import { esc, fmtAro, fmtPts, fmtTime, $ } from '../ui.js';
import { batchWindow, venueOf } from '../schedule.js';

export function renderMe(el, d) {
  if (!can('player')) {
    el.innerHTML = `
      <div class="panel corner" style="max-width:640px;margin:8vh auto 0">
        <div class="phead"><h2>我的比赛</h2><span class="sub">PLAYER AREA</span></div>
        <div class="empty">参赛队员登录后可在此查看本队对阵与排名、提出弃赛或场次调换申请。<br>账号由组委会发放。</div>
        <div class="flex" style="justify-content:center;margin-top:14px">
          <button class="btn btn-cy" id="me-gologin">裁判 / 队员登录</button>
          <a class="btn" href="#/board">先看排名 →</a>
        </div>
      </div>`;
    const go = $('#me-gologin', el);
    if (go) go.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dubov:open-login')));
    return;
  }
  if (!d.hasTournament) {
    el.innerHTML = '<div class="panel corner"><div class="empty">赛事尚未创建，等待组委会建赛。</div></div>';
    return;
  }
  if (!app.me?.teamId) {
    el.innerHTML = '<div class="panel corner"><div class="empty">当前账号未绑定队伍（仅裁判/管理员角色）。如为参赛队员请联系组委会补绑。</div></div>';
    return;
  }

  const teamId = app.me.teamId;
  const team = d.state.teams.find((t) => t.id === teamId);
  const row = d.standings.find((r) => r.teamId === teamId);
  const pending = d.pending;
  const myPair = pending?.pairings.find((p) => p.a === teamId || p.b === teamId) || null;
  const myRequests = (d.state.requests || []).filter((r) => r.teamId === teamId).slice().reverse();

  const oppName = (p) => p ? (p.a === teamId ? p.b : p.a) : null;

  el.innerHTML = `
    ${team?.withdrawn ? '<div class="banner red">本队已退赛——后续轮次不再参与对阵。如有疑问请联系组委会。</div>' : ''}

    <div class="me-grid">
      <div class="panel corner">
        <div class="phead"><h2>本队战绩</h2><span class="sub">MY TEAM</span></div>
        <div class="me-team">
          <div class="nm">${esc(team?.name || teamId)} ${team?.withdrawn ? '<span class="tag tag-out">已退赛</span>' : ''}</div>
          <div class="kv mt">
            <div><div class="k">当前排名</div><div class="v amber">${row ? `#${row.rank}` : '—'}</div></div>
            <div><div class="k">积分</div><div class="v">${row ? fmtPts(row.score) : '—'}</div></div>
            <div><div class="k">ARO</div><div class="v">${row ? fmtAro(row.aro) : '—'}</div></div>
            <div><div class="k">胜-平-负</div><div class="v dim">${row ? `${row.wins}-${row.draws}-${row.losses}` : '—'}</div></div>
          </div>
        </div>
      </div>

      <div class="panel corner">
        <div class="phead"><h2>本轮对阵</h2><span class="sub">ROUND ${pending ? pending.round : '—'}</span></div>
        ${pending && myPair ? (() => {
          const win = batchWindow(pending.round, myPair.board, pending.pairings.length, pending.timeOffset ?? d.state.settings?.scheduleOffsetMin);
          const venue = venueOf(myPair.board, pending.pairings.length);
          const mySide = myPair.a === teamId ? '红方' : '蓝方';
          return `<div class="pairing">
            <div class="board-no"><span class="venue ${venue.key === 'A' ? 'vA' : 'vB'}">${venue.name}</span>${String(myPair.board).padStart(2, '0')}<span class="bt">${win.day} ${win.label}</span></div>
            <div class="side left"><span class="nm ${myPair.result === 'a' ? 'amber' : ''}"><i class="side-chip r">红</i>${esc(teamNameOf(d, myPair.a))}</span><span class="aro">ARO ${fmtAro(myPair.aroA)}</span></div>
            <span class="vs-sep">${myPair.result === 'a' ? '1:0' : myPair.result === 'b' ? '0:1' : myPair.result === 'draw' ? '½:½' : 'VS'}</span>
            <div class="side right"><span class="nm ${myPair.result === 'b' ? 'cy' : ''}">${esc(teamNameOf(d, myPair.b))}<i class="side-chip b">蓝</i></span><span class="aro">ARO ${fmtAro(myPair.aroB)}</span></div>
            <div></div>
          </div>
          <p class="hint">本队为本局<strong>${mySide}</strong>。请提前 10 分钟到达<strong>${venue.name}</strong>候场（批次 ${String(win.batch).padStart(2, '0')} · ${win.day} ${win.start}–${win.end}）。</p>
          ${myPair.board === pending.pairings.length && pending.pairings.length > 1 ? '<p class="hint">本队本轮为最后一局（可能经场次调换）。</p>' : ''}`; })()
        : `<div class="empty">${pending ? '本轮没有本队对局（轮空或已退赛）' : d.swissDone ? '瑞士轮已结束' : '等待管理员生成对阵'}</div>`}
      </div>
    </div>

    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>向组委会提交申请</h2><span class="sub">REQUEST · 条款 5.3.4</span></div>
      ${team?.withdrawn
        ? '<p class="hint">本队已退赛，无法再提交申请。</p>'
        : `
      <div class="banner">申请将由管理员核实后执行，本队无法直接改动比赛状态。条款 5.3.4：轮次开始前可申请<strong>场次调换</strong>（本轮排至最后一局）；<strong>弃赛</strong>一经批准即本轮判负并退出后续所有轮次，请谨慎提交。</div>
      <div class="form-row">
        <div class="field grow" style="min-width:220px"><label>申请理由（选填，200 字内）</label><input type="text" id="rq-reason" maxlength="200" placeholder="例：设备故障，申请本轮调到最后一场"></div>
        <button class="btn" id="rq-reschedule" ${pending && myPair && myPair.result == null ? '' : 'disabled'}>申请场次调换</button>
        <button class="btn btn-danger" id="rq-withdraw">申请弃赛</button>
      </div>
      <p class="hint mt">${(!pending || !myPair) ? '场次调换需要本轮已生成对阵且本队对局未录入结果。' : ''}</p>
      `}
    </div>

    <div class="panel corner" style="margin-top:18px">
      <div class="phead"><h2>我的申请记录</h2><span class="sub">MY REQUESTS</span></div>
      ${myRequests.length ? `
        <table class="grid">
          <thead><tr><th>时间</th><th>类型</th><th>理由</th><th>状态</th></tr></thead>
          <tbody>${myRequests.map((r) => `
            <tr>
              <td class="mono dim">${fmtTime(Date.parse(r.requestedAt))}</td>
              <td>${r.type === 'withdraw' ? '<span class="tag tag-out">弃赛</span>' : '<span class="tag tag-atk">场次调换</span>'}</td>
              <td class="dim">${esc(r.reason || '—')}</td>
              <td>${r.status === 'pending' ? '<span class="tag tag-bye">待处理</span>' : r.status === 'approved' ? '<span class="tag tag-up">已批准</span>' : '<span class="tag tag-out">已拒绝</span>'}${r.handledAt ? ` <span class="hint">${fmtTime(Date.parse(r.handledAt))}</span>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="hint">暂无申请记录。</p>'}
    </div>
  `;

  bindMe(el, d);
}

function teamNameOf(d, id) {
  const t = d.state.teams.find((x) => x.id === id);
  return t ? t.name : id;
}

function bindMe(el, d) {
  const reason = () => $('#rq-reason', el)?.value || '';
  const wdBtn = $('#rq-withdraw', el);
  const rsBtn = $('#rq-reschedule', el);
  if (wdBtn) wdBtn.addEventListener('click', async () => {
    if (!confirm('确认提交弃赛申请？\n\n批准后本轮判负并退出后续所有轮次（条款 5.3.4），请确保与组委会沟通后再提交。')) return;
    await api('POST', '/requests', { type: 'withdraw', reason: reason() });
    toast('弃赛申请已提交，等待管理员处理');
  });
  if (rsBtn) rsBtn.addEventListener('click', async () => {
    await api('POST', '/requests', { type: 'reschedule', reason: reason() });
    toast('场次调换申请已提交，等待管理员处理');
  });
}
