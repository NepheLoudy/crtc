// 视图：赛前设置 —— 建赛向导 / 队伍管理 / 规则参数
import { api } from '../api.js';
import { esc, $ } from '../ui.js';

const SAMPLE = [
  ['量子波动', 92], ['光棱坦克', 88], ['天启装甲', 85], ['基洛夫空艇', 82],
  ['幻影引擎', 79], ['磁暴线圈', 76], ['犀牛重装', 73], ['履带履带', 70],
  ['动员兵王', 67], ['侦察哨机', 64], ['矿车疾驰', 61], ['雷达站', 58],
];

let editingId = null;

export function renderSetup(el, d) {
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
      <div class="phead"><h2>危险区</h2><span class="sub">DANGER ZONE</span></div>
      <div class="flex">
        <button class="btn btn-danger" id="destroy-t">销毁赛事重建</button>
        <span class="hint">清空全部数据（含撤销栈），不可恢复。</span>
      </div>
    </div>
  `;
  bindRoster(el, d, started);
  bindRules(el);
}

function rosterTable(s, started) {
  if (s.teams.length === 0) return '<div class="empty">尚无队伍 — 用下方表单或批量导入添加</div>';
  const rows = s.teams.map((t, i) => {
    const edit = editingId === t.id;
    return `<tr class="row-anim" style="animation-delay:${i * 22}ms">
      <td class="num">${i + 1}</td>
      <td>${edit
        ? `<input type="text" data-edit-name="${t.id}" value="${esc(t.name)}" style="max-width:220px">`
        : `<span class="team-name"><span class="nm">${esc(t.name)}</span>${t.withdrawn ? '<span class="tag tag-out">弃赛</span>' : ''}</span>`}</td>
      <td>${edit
        ? `<input type="number" data-edit-score="${t.id}" value="${t.initialScore}" style="max-width:90px">`
        : `<span class="mono">${t.initialScore}</span>`}</td>
      <td class="num">${started && !edit ? '<span class="hint">见瑞士轮页</span>' : '—'}</td>
      <td style="white-space:nowrap">
        ${edit
          ? `<button class="btn btn-sm btn-primary" data-save="${t.id}">保存</button>
             <button class="btn btn-sm" data-cancel="1">取消</button>`
          : `<button class="btn btn-sm" data-edit="${t.id}" ${t.withdrawn ? 'disabled' : ''}>编辑</button>
             ${t.withdrawn
               ? `<button class="btn btn-sm btn-cy" data-reinstate="${t.id}">恢复</button>`
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
  const sampleText = SAMPLE.map(([n, v]) => `${n},${v}`).join('\n');
  return `
    <div class="panel corner" style="max-width:860px;margin:4vh auto 0">
      <div class="phead"><h2>创建赛事</h2><span class="sub">TOURNAMENT SETUP</span></div>
      <div class="form-row">
        <div class="field grow" style="min-width:240px"><label>赛事名称</label><input type="text" id="cw-name" placeholder="例：第X届 XX 对抗赛" value="杜博夫系统对抗赛"></div>
        <div class="field" style="max-width:150px"><label>瑞士轮轮数</label><input type="number" id="cw-rounds" value="6" min="1" max="20"></div>
      </div>
      <div class="field mt">
        <label>队伍名单（每行一支：队伍名,中期考核得分总分）</label>
        <textarea id="cw-teams" style="min-height:220px" placeholder="队伍名,分数">${esc(sampleText)}</textarea>
        <span class="hint">预置了 12 支示例队伍可直接开赛；正式使用时清空替换。逗号可省略（计 0 分）。条款 5.3.3：该分数即首轮 ARO。</span>
      </div>
      <div class="flex mt" style="margin-top:20px">
        <button class="btn btn-primary btn-lg" id="cw-go">创建赛事</button>
        <span class="hint">创建后可继续在名单中增删队伍，生成第 1 轮对阵后名单将锁定删除权限。</span>
      </div>
    </div>`;
}

function bindCreate(el) {
  $('#cw-go', el).addEventListener('click', async () => {
    const name = $('#cw-name', el).value.trim();
    const totalRounds = Number($('#cw-rounds', el).value) || 6;
    const teams = parseTeams($('#cw-teams', el).value);
    if (teams.length < 2) return toast('至少需要 2 支队伍', true);
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
      if (!confirm(`确认「${name}」退赛？\n\n· 瑞士轮：本轮与其对局不自动判定，需你手动录入结果（条款 5.3.4：进行中弃赛应判负）；后续轮次自动剔除。\n· 淘汰赛：防守方退赛由进攻队列队首继承防线，进攻方退赛该场转人工结算。`)) return;
      await api('POST', `/teams/${t.dataset.withdraw}/withdraw`, { midRound: true });
      toast(`「${name}」已标记退赛`);
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
