// 视图：赛前设置 —— 建赛向导 / 队伍管理 / 规则参数（管理员专属）+ 审计日志
import { api } from '../api.js';
import { can } from '../main.js';
import { esc, fmtTime, $ } from '../ui.js';

const SAMPLE = [
  ['量子波动', 92], ['光棱坦克', 88], ['天启装甲', 85], ['基洛夫空艇', 82],
  ['幻影引擎', 79], ['磁暴线圈', 76], ['犀牛重装', 73], ['履带履带', 70],
  ['动员兵王', 67], ['侦察哨机', 64], ['矿车疾驰', 61], ['雷达站', 58],
];

let editingId = null;

export function renderSetup(el, d) {
  if (!can('admin')) {
    el.innerHTML = `
      <div class="panel corner" style="max-width:640px;margin:6vh auto 0">
        <div class="phead"><h2>赛前设置</h2><span class="sub">ADMIN ONLY</span></div>
        <div class="empty">本页为管理员专属（建赛 / 名册 / 规则 / 审计）。<br>裁判请在「瑞士轮」「淘汰赛」页录入结果；观众无需登录即可观看排名。</div>
        <div class="flex" style="justify-content:center;margin-top:14px">
          <a class="btn" href="#/swiss">前往瑞士轮 →</a>
          <a class="btn" href="#/board">排名大屏 →</a>
        </div>
      </div>`;
    return;
  }
  if (!d.hasTournament) {
    el.innerHTML = createWizard();
    bindCreate(el);
    return;
  }
  const s = d.state;
  const started = s.swiss.rounds.length > 0;
  el.innerHTML = `
    <div class="panel corner">
      <div class="phead">
        <h2>队伍名册</h2>
        <span class="sub">ROSTER · ${s.teams.length} 队 · 弃赛 ${s.teams.filter((t) => t.withdrawn).length}</span>
        <span class="sp">
          <a class="btn btn-sm" href="/api/export/standings.csv" download>导出排名 CSV</a>
          <a class="btn btn-sm" href="/api/export/json" download>导出全量 JSON</a>
        </span>
      </div>
      <div class="banner cy mb">中期考核得分将作为<strong>首轮 ARO</strong>（条款 5.3.3）。开赛后修改初始分不影响已完成轮次的 ARO 账目。</div>
      ${rosterTable(s, started)}
      <div class="form-row mt">
        <div class="field"><label>新队伍名称</label><input type="text" id="nt-name" placeholder="队伍名"></div>
        <div class="field" style="max-width:130px"><label>中期考核分</label><input type="number" id="nt-score" value="60" min="0" max="999"></div>
        <button class="btn" id="nt-add">＋ 添加</button>
        <button class="btn" id="nt-bulk">批量导入</button>
      </div>
      <div id="bulk-box" hidden class="mt">
        <textarea id="nt-bulk-text" placeholder="每行一支：队伍名,中期考核分&#10;例如：&#10;闪电风暴,88&#10;钢铁洪流,75"></textarea>
        <div class="flex mt"><button class="btn btn-primary btn-sm" id="nt-bulk-go">导入以上队伍</button><span class="hint">逗号可省略（省略时计 0 分）</span></div>
      </div>
    </div>

    <div class="panel corner">
      <div class="phead"><h2>规则参数</h2><span class="sub">RULESET</span></div>
      ${rulesForm(s)}
      <div class="flex mt">
        <button class="btn btn-primary" id="save-rules">保存参数</button>
        <span class="hint">荣誉系数：上调者胜 ×${s.settings.promoteBase}<sup>n</sup>，下调者负 ×${s.settings.demoteBase}<sup>n</sup>（仅计当轮对手 ARO 项，条款 5.3.2）</span>
      </div>
    </div>

    <div class="panel corner">
      <div class="phead">
        <h2>队员申请</h2><span class="sub">PLAYER REQUESTS · 条款 5.3.4</span>
      </div>
      ${(s.requests || []).length ? `
        <table class="grid">
          <thead><tr><th>时间</th><th>队伍</th><th>类型</th><th>理由</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${s.requests.slice().reverse().map((r) => {
            const team = s.teams.find((t) => t.id === r.teamId);
            return `
            <tr>
              <td class="mono dim">${fmtTime(Date.parse(r.requestedAt))}</td>
              <td>${esc(team?.name || r.teamId)}</td>
              <td>${r.type === 'withdraw' ? '<span class="tag tag-out">弃赛</span>' : '<span class="tag tag-atk">场次调换</span>'}</td>
              <td class="dim">${esc(r.reason || '—')}</td>
              <td>${r.status === 'pending' ? '<span class="tag tag-bye">待处理</span>' : r.status === 'approved' ? '<span class="tag tag-up">已批准</span>' : '<span class="tag tag-out">已拒绝</span>'}</td>
              <td>${r.status === 'pending' ? `
                <button class="btn btn-sm btn-primary" data-approve="${r.id}">批准</button>
                <button class="btn btn-sm" data-reject="${r.id}">拒绝</button>` : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<p class="hint">暂无队员申请。队员在「我的比赛」页提交弃赛 / 场次调换申请后在此处理。</p>'}
    </div>

    <div class="panel corner">
      <div class="phead">
        <h2>操作日志</h2><span class="sub">AUDIT · 可追溯</span>
        <span class="sp"><button class="btn btn-sm" id="audit-refresh">刷新</button></span>
      </div>
      <div id="audit-box"><p class="hint">点击「刷新」加载最近操作记录（含登录与全部变更，服务端 append-only 记账）。</p></div>
    </div>

    <div class="panel corner">
      <div class="phead"><h2>危险区</h2><span class="sub">DANGER ZONE</span></div>
      <div class="flex">
        <button class="btn btn-danger" id="destroy-t">销毁赛事重建</button>
        <span class="hint">清空全部数据（含撤销栈），不可恢复。</span>
      </div>
    </div>
  `;
  bindRoster(el, d, started);
  bindRules(el);
  bindAudit(el);
}

async function loadAudit(el) {
  const box = $('#audit-box', el);
  box.innerHTML = '<p class="hint">加载中…</p>';
  try {
    const { entries } = await api('GET', '/audit?limit=200');
    if (!entries.length) { box.innerHTML = '<p class="hint">暂无记录</p>'; return; }
    box.innerHTML = `<div class="log-feed">${entries.map((e) => `
      <div class="lg ${e.ok ? '' : 'elim'}"><span class="dim">${fmtTime(Date.parse(e.ts))}</span> — <b>${esc(e.user)}</b>(${esc(e.role)}) ${esc(e.action)}${e.ok ? '' : ` <span class="red">✗ ${esc(e.error || '')}</span>`} <span class="dim">${esc(e.ip)}</span></div>`).join('')}</div>`;
  } catch {
    box.innerHTML = '<p class="hint">加载失败（需要管理员会话）</p>';
  }
}

function bindAudit(el) {
  $('#audit-refresh', el).addEventListener('click', () => loadAudit(el));
}

function rosterTable(s, started) {
  if (s.teams.length === 0) return '<div class="empty">尚无队伍 — 用下方表单或批量导入添加</div>';
  const rows = s.teams.map((t, i) => {
    const edit = editingId === t.id;
    return `<tr class="row-anim" style="animation-delay:${i * 22}ms">
      <td class="num">${i + 1}</td>
      <td>${edit
        ? `<input type="text" data-edit-name="${t.id}" value="${esc(t.name)}" style="max-width:220px">`
        : `<span class="team-name"><span class="nm">${esc(t.name)}</span>${t.withdrawn ? '<span class="tag tag-out">弃赛</span>' : ''}${t.suspended ? '<span class="tag tag-bye">停赛</span>' : ''}</span>`}</td>
      <td>${edit
        ? `<input type="number" data-edit-score="${t.id}" value="${t.initialScore}" style="max-width:90px">`
        : `<span class="mono">${t.initialScore}</span>`}</td>
      <td class="num">${started && !edit ? '<span class="hint">见瑞士轮页</span>' : '—'}</td>
      <td style="white-space:nowrap">
        ${edit
          ? `<button class="btn btn-sm btn-primary" data-save="${t.id}">保存</button>
             <button class="btn btn-sm" data-cancel="1">取消</button>`
          : `<button class="btn btn-sm" data-edit="${t.id}" ${t.withdrawn || t.suspended ? 'disabled' : ''}>编辑</button>
             ${t.withdrawn || t.suspended
               ? `<button class="btn btn-sm btn-cy" data-reinstate="${t.id}" title="${t.suspended ? '解除停赛（本轮已删的对局不恢复，下轮回归）' : '恢复参赛'}">恢复</button>`
               : `<button class="btn btn-sm btn-danger" data-withdraw="${t.id}" title="条款 5.3.4：本轮进行中弃赛将判负">弃赛</button>`}`
             }
      </td>
    </tr>`;
  }).join('');
  return `
    <table class="grid">
      <thead><tr><th>#</th><th>队伍</th><th>中期考核分</th><th>ARO</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function rulesForm(s) {
  const st = s.settings;
  return `
    <div class="form-row">
      <div class="field" style="min-width:220px"><label>赛事名称</label><input type="text" id="rs-name" value="${esc(s.meta.name)}"></div>
      <div class="field" style="max-width:130px"><label>瑞士轮轮数</label><input type="number" id="rs-rounds" value="${s.meta.totalRounds}" min="1" max="20"></div>
      <div class="field" style="max-width:110px"><label>胜局分</label><input type="number" id="rs-win" value="${st.winPoints}"></div>
      <div class="field" style="max-width:110px"><label>平局分</label><input type="number" id="rs-draw" value="${st.drawPoints}"></div>
      <div class="field" style="max-width:110px"><label>负局分</label><input type="number" id="rs-loss" value="${st.lossPoints}"></div>
      <div class="field" style="max-width:110px"><label>轮空分</label><input type="number" id="rs-bye" value="${st.byePoints}" title="规则未规定轮空得分，默认记胜局分"></div>
    </div>
    <div class="form-row mt">
      <div class="field" style="max-width:110px"><label>上调系数底数</label><input type="number" step="0.01" id="rs-pk" value="${st.promoteBase}"></div>
      <div class="field" style="max-width:110px"><label>下调系数底数</label><input type="number" step="0.01" id="rs-dk" value="${st.demoteBase}"></div>
      <div class="field" style="min-width:200px"><label>系数指数 n</label>
        <select id="rs-exp">
          <option value="round" ${st.honorExponentMode === 'round' ? 'selected' : ''}>当前轮数（k=1.04^轮数）</option>
          <option value="fixed1" ${st.honorExponentMode === 'fixed1' ? 'selected' : ''}>固定 1（k=1.04）</option>
          <option value="streak" ${st.honorExponentMode === 'streak' ? 'selected' : ''}>连续上调/下调次数</option>
        </select>
      </div>
    </div>
    <div class="form-row mt">
      <div class="field" style="max-width:110px"><label>防守方初始分</label><input type="number" step="0.5" id="rs-dstart" value="${st.defenderStart}"></div>
      <div class="field" style="max-width:110px"><label>进攻方初始分</label><input type="number" step="0.5" id="rs-astart" value="${st.attackerStart}"></div>
      <div class="field" style="max-width:110px"><label>防守分上限</label><input type="number" step="0.5" id="rs-dcap" value="${st.defenderCap}"></div>
    </div>`;
}

function createWizard() {
  return `
    <div class="panel corner" style="max-width:980px;margin:4vh auto 0">
      <div class="phead"><h2>创建赛事</h2><span class="sub">TOURNAMENT SETUP</span></div>
      <div class="form-row">
        <div class="field grow" style="min-width:240px"><label>赛事名称</label><input type="text" id="cw-name" placeholder="例：第X届 XX 对抗赛" value="杜博夫系统对抗赛"></div>
        <div class="field" style="max-width:150px"><label>瑞士轮轮数</label><input type="number" id="cw-rounds" value="6" min="1" max="20"></div>
      </div>
      <div class="mt">
        <label>参赛队伍录入（填队伍名与中期考核得分总分，该分数即首轮 ARO · 条款 5.3.3）</label>
        <table class="grid" id="cw-teams-table">
          <thead><tr><th style="width:44px">#</th><th>队伍名</th><th style="width:150px">中期考核得分</th><th style="width:70px"></th></tr></thead>
          <tbody id="cw-teams-body"></tbody>
        </table>
        <div class="flex mt" style="gap:8px">
          <button class="btn btn-sm" id="cw-add-row">＋ 添加一行</button>
          <button class="btn btn-sm" id="cw-paste-toggle">⇪ 粘贴批量导入</button>
          <button class="btn btn-sm" id="cw-sample">载入示例</button>
          <button class="btn btn-sm" id="cw-clear">清空</button>
          <span class="hint">至少 2 支队伍；正式使用前请清掉示例数据。</span>
        </div>
        <div id="cw-paste-box" hidden class="mt">
          <textarea id="cw-paste-text" placeholder="每行一支：队伍名,中期考核得分&#10;例如：&#10;闪电风暴,88&#10;钢铁洪流,75" style="min-height:120px"></textarea>
          <div class="flex mt"><button class="btn btn-primary btn-sm" id="cw-paste-go">追加到表格</button><span class="hint">逗号可省略（省略时计 0 分）；追加不会覆盖已填行。</span></div>
        </div>
      </div>
      <div class="flex mt" style="margin-top:20px">
        <button class="btn btn-primary btn-lg" id="cw-go">创建赛事</button>
        <span class="hint">创建后可在「赛前设置 → 队伍名册」继续增改；生成第 1 轮对阵后名单将锁定删除权限。</span>
      </div>
    </div>`;
}

function wizardRowHtml(name = '', score = '') {
  return `
    <tr>
      <td class="num dim"></td>
      <td><input type="text" data-tw-name value="${esc(name)}" placeholder="队伍名" style="width:100%;max-width:280px"></td>
      <td><input type="number" data-tw-score value="${esc(score)}" min="0" max="999" placeholder="0" style="max-width:110px"></td>
      <td><button class="btn btn-sm" data-del-row title="删除本行">✕</button></td>
    </tr>`;
}

function renumberWizardRows(body) {
  [...body.querySelectorAll('tr')].forEach((tr, i) => {
    tr.firstElementChild.textContent = i + 1;
  });
}

function bindCreate(el) {
  const body = $('#cw-teams-body', el);
  body.innerHTML = wizardRowHtml(); // 初始留一空行引导录入
  $('#cw-add-row', el).addEventListener('click', () => {
    body.insertAdjacentHTML('beforeend', wizardRowHtml());
    renumberWizardRows(body);
    body.lastElementChild.querySelector('[data-tw-name]').focus();
  });
  $('#cw-sample', el).addEventListener('click', () => {
    body.innerHTML = SAMPLE.map(([n, v]) => wizardRowHtml(n, v)).join('');
    renumberWizardRows(body);
    toast('已载入 12 支示例队伍，正式使用前请清空');
  });
  $('#cw-clear', el).addEventListener('click', () => {
    body.innerHTML = wizardRowHtml();
  });
  $('#cw-paste-toggle', el).addEventListener('click', () => {
    $('#cw-paste-box', el).hidden = !$('#cw-paste-box', el).hidden;
  });
  $('#cw-paste-go', el).addEventListener('click', () => {
    const teams = parseTeams($('#cw-paste-text', el).value);
    if (!teams.length) return toast('没有可导入的行', true);
    body.insertAdjacentHTML('beforeend', teams.map((t) => wizardRowHtml(t.name, t.initialScore)).join(''));
    renumberWizardRows(body);
    $('#cw-paste-text', el).value = '';
    toast(`已追加 ${teams.length} 支队伍`);
  });
  // 删除行（委托绑定）
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-row]');
    if (!del) return;
    del.closest('tr').remove();
    if (!body.querySelector('tr')) body.innerHTML = wizardRowHtml();
    renumberWizardRows(body);
  });

  $('#cw-go', el).addEventListener('click', async () => {
    const name = $('#cw-name', el).value.trim();
    const totalRounds = Number($('#cw-rounds', el).value) || 6;
    const teams = [...body.querySelectorAll('tr')]
      .map((tr) => ({
        name: tr.querySelector('[data-tw-name]').value.trim(),
        initialScore: Number(tr.querySelector('[data-tw-score]').value) || 0,
      }))
      .filter((t) => t.name);
    if (teams.length < 2) return toast('至少需要 2 支队伍（填了名字的行才会计入）', true);
    await api('POST', '/tournament', { name, totalRounds, teams });
    toast(`赛事「${name}」已创建，共 ${teams.length} 支队伍`);
  });
}

function parseTeams(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(.*?)[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { name: m[1].trim(), initialScore: Number(m[2]) };
    return { name: line, initialScore: 0 };
  });
}

function bindRoster(el, d, started) {
  $('#nt-add', el).addEventListener('click', async () => {
    const name = $('#nt-name', el).value.trim();
    if (!name) return toast('请输入队伍名', true);
    await api('POST', '/teams', { teams: [{ name, initialScore: Number($('#nt-score', el).value) || 0 }] });
    toast(`已添加「${name}」`);
  });

  $('#nt-bulk', el).addEventListener('click', () => {
    const box = $('#bulk-box', el);
    box.hidden = !box.hidden;
  });
  $('#nt-bulk-go', el)?.addEventListener('click', async () => {
    const teams = parseTeams($('#nt-bulk-text', el).value);
    if (!teams.length) return toast('没有可导入的行', true);
    await api('POST', '/teams', { teams });
    toast(`已导入 ${teams.length} 支队伍`);
  });

  // 覆盖式绑定：避免 SSE 重渲染下监听器叠加
  el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.approve) {
      const req = d.state.requests.find((r) => r.id === t.dataset.approve);
      const isWithdraw = req?.type === 'withdraw';
      if (!confirm(`批准${isWithdraw ? '弃赛' : '场次调换'}申请？${isWithdraw ? '\n\n批准后该队本轮判负并退出后续所有轮次（判负推进自动结算）。' : '\n\n批准后该队本轮对局将排至最后一台。'}`)) return;
      await api('POST', `/requests/${t.dataset.approve}/approve`, {});
      toast('申请已批准，规则已推进');
      return;
    }
    if (t.dataset.reject) {
      await api('POST', `/requests/${t.dataset.reject}/reject`, {});
      toast('申请已拒绝');
      return;
    }
    if (t.dataset.edit) { editingId = t.dataset.edit; renderSetup(el, d); return; }
    if (t.dataset.cancel) { editingId = null; renderSetup(el, d); return; }
    if (t.dataset.save) {
      const id = t.dataset.save;
      const name = $(`[data-edit-name="${id}"]`, el).value.trim();
      const initialScore = Number($(`[data-edit-score="${id}"]`, el).value) || 0;
      await api('PUT', `/teams/${id}`, { name, initialScore });
      editingId = null;
      toast('已保存');
      return;
    }
    if (t.dataset.withdraw) {
      const name = d.state.teams.find((x) => x.id === t.dataset.withdraw)?.name || '';
      if (!confirm(`确认「${name}」退赛？\n\n标记后规则自动推进（条款 5.3.4）：\n· 瑞士轮：本轮未录入的对局自动判负，该轮 ARO 项照常入账，后续轮次剔除。\n· 淘汰赛：正在进行的场次直接判负并正常结算（防守方退赛则进攻方破防接任），退赛者不再回队列。`)) return;
      await api('POST', `/teams/${t.dataset.withdraw}/withdraw`, { midRound: true });
      toast(`「${name}」已退赛，规则推进完成`);
      return;
    }
    if (t.dataset.reinstate) {
      await api('POST', `/teams/${t.dataset.reinstate}/reinstate`);
      toast('已恢复参赛');
      return;
    }
    if (t.id === 'destroy-t') {
      if (!confirm('销毁赛事？全部数据（含撤销栈）将被清空且不可恢复。')) return;
      if (!confirm('再次确认：真的要销毁吗？')) return;
      await api('POST', '/tournament/reset');
      toast('赛事已销毁');
    }
  };
}

function bindRules(el) {
  $('#save-rules', el).addEventListener('click', async () => {
    await api('PUT', '/settings', {
      meta: { name: $('#rs-name', el).value, totalRounds: Number($('#rs-rounds', el).value) },
      settings: {
        winPoints: Number($('#rs-win', el).value),
        drawPoints: Number($('#rs-draw', el).value),
        lossPoints: Number($('#rs-loss', el).value),
        byePoints: Number($('#rs-bye', el).value),
        promoteBase: Number($('#rs-pk', el).value),
        demoteBase: Number($('#rs-dk', el).value),
        honorExponentMode: $('#rs-exp', el).value,
        defenderStart: Number($('#rs-dstart', el).value),
        attackerStart: Number($('#rs-astart', el).value),
        defenderCap: Number($('#rs-dcap', el).value),
      },
    });
    toast('规则参数已保存');
  });
}
