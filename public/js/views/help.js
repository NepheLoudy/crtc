// 视图：使用说明（裁判 / 参赛队员两版，管理员可看全部 + 运维备忘）
import { esc, $ } from '../ui.js';

export function renderHelp(el, d) {
  el.innerHTML = `
    <div class="help-tabs mb">
      <button class="btn btn-sm tab-btn on" data-tab="player">参赛队员须知</button>
      <button class="btn btn-sm tab-btn" data-tab="referee">裁判操作手册</button>
      <button class="btn btn-sm tab-btn" data-tab="admin">管理员备忘</button>
    </div>
    <div id="help-body"></div>
  `;
  const show = (key) => {
    $$('.tab-btn', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    $('#help-body', el).innerHTML = DOCS[key];
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.tab-btn');
    if (b) show(b.dataset.tab);
  });
  show('player');
}

const DOCS = {
  player: `
    <div class="panel corner">
      <div class="phead"><h2>参赛队员须知</h2><span class="sub">FOR PLAYERS</span></div>
      <h3 class="amber mt">1. 登录</h3>
      <ul class="doc-list">
        <li>账号与密码由组委会统一发放，<b>不开放注册</b>；每个队员账号已绑定本队。</li>
        <li>点右上角「裁判登录」，用组委会发的账号进入「我的比赛」页。</li>
        <li>同一账号同时在别处登录会把这边顶下线（防账号共享），属正常现象。</li>
      </ul>
      <h3 class="amber mt">2. 能看什么</h3>
      <ul class="doc-list">
        <li><b>我的比赛</b>：本队排名、积分、ARO、本轮对阵（对手与台号）。</li>
        <li><b>瑞士轮 / 淘汰赛 / 排名大屏</b>：全程只读围观，所有对阵与排名实时更新。</li>
      </ul>
      <h3 class="amber mt">3. 能申请什么（条款 5.3.4）</h3>
      <ul class="doc-list">
        <li><b>申请场次调换</b>：轮次开始前提出，批准后本队本轮对局排至<b>最后一台</b>。本轮结果已录入后不可调换。</li>
        <li><b>申请弃赛</b>：批准后本队<b>本轮判负</b>并退出后续所有轮次（排序中删除），请务必先与组委会当面确认再提交。</li>
        <li>申请在「我的比赛」页提交，需填写理由；状态会显示「待处理 / 已批准 / 已拒绝」。</li>
        <li>队员<b>没有</b>任何成绩编辑权限——比分、对阵、排名均由裁判与管理员操作。</li>
      </ul>
      <h3 class="amber mt">4. 注意事项</h3>
      <ul class="doc-list">
        <li>积分规则：胜 3 分、平 1 分、负 0 分；名次按积分 → ARO 排序。</li>
        <li>所有操作（含申请与批准）均记录在审计日志中，可追溯。</li>
        <li>对成绩有疑问请联系组委会，勿在赛场纠缠裁判。</li>
      </ul>
    </div>`,

  referee: `
    <div class="panel corner">
      <div class="phead"><h2>裁判操作手册</h2><span class="sub">FOR REFEREES</span></div>
      <h3 class="amber mt">1. 登录</h3>
      <ul class="doc-list">
        <li>右上角「裁判登录」→ 输入组委会发放的裁判账号。裁判账号只能录入成绩，不能改动名册、规则与对阵。</li>
      </ul>
      <h3 class="amber mt">2. 瑞士轮成绩录入（每轮）</h3>
      <ul class="doc-list">
        <li>「瑞士轮」页确认台号与对阵（对阵由管理员生成，裁判无权生成/重排）。</li>
        <li>每台对局点 <b>胜 / 平 / 胜</b> 三个按钮中的一边（左右两侧按钮分别代表左右队伍）。录错可随时重按覆盖，<b>确认前</b>均可修改。</li>
        <li>全部录入后点「<b>确认本轮成绩，结算 ARO</b>」——确认后积分与 ARO 立即结算并全网刷新，<b>确认动作不可由裁判撤销</b>（需要联系管理员）。</li>
        <li>某台显示「弃赛判负」为系统自动判负，无需录入；其余场次必须全部录入才能确认。</li>
      </ul>
      <h3 class="amber mt">3. 淘汰赛录局（车轮战 + 决赛）</h3>
      <ul class="doc-list">
        <li>「淘汰赛」页两个组控制台：<b>◆ 防守胜 / 平局 / 进攻胜 ▲</b> 对应一局结果，逐局录入。</li>
        <li>一方先赢 2 局该场自动结算并开启下一场；平局不加胜负，加赛至分出。</li>
        <li>决赛同理：先胜 2 局者夺冠，录完自动进入颁奖页。</li>
        <li>队员退赛由管理员处理（该场自动判负推进），裁判无需操作。</li>
      </ul>
      <h3 class="amber mt">4. 注意事项</h3>
      <ul class="doc-list">
        <li>录入即生效并广播到所有屏幕与审计日志——按纸质记分表<b>核对后再点</b>。</li>
        <li>无法确认/按钮置灰时，看提示：通常是结果未录齐，或该阶段不在你的权限内。</li>
        <li>遇到「需要登录」弹窗说明会话被顶下线，重新登录即可。</li>
      </ul>
    </div>`,

  admin: `
    <div class="panel corner">
      <div class="phead"><h2>管理员备忘</h2><span class="sub">ADMIN ONLY</span></div>
      <h3 class="amber mt">账号发放</h3>
      <ul class="doc-list">
        <li>在小电脑（部署机）上执行：<code>node scripts/user.mjs add 用户名 密码 referee</code>（裁判）、<code>... player 队伍ID</code>（队员，必须绑定 tN）。</li>
        <li>改密 <code>passwd</code>、删除 <code>remove</code>、列表 <code>list</code>。</li>
      </ul>
      <h3 class="amber mt">队员申请处理</h3>
      <ul class="doc-list">
        <li>「赛前设置 → 队员申请」面板：批准弃赛走判负推进（瑞士轮判负 / 淘汰赛该场判负+身份推进）；批准调换把该场排至本轮最后一台。</li>
      </ul>
      <h3 class="amber mt">数据与追溯</h3>
      <ul class="doc-list">
        <li>全部变更落盘 <code>data/tournament.json</code>（原子写）；审计账本 <code>data/audit.jsonl</code>（谁/何时/操作/IP）。</li>
        <li>撤销栈 40 步（顶栏「撤销」按钮）；导出：排名 CSV（公开）与全量 JSON（管理员）。</li>
      </ul>
    </div>`,
};
