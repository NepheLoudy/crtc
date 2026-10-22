// 视图：使用说明（比赛规则 / 裁判 / 参赛队员三版，管理员可看全部 + 运维备忘）
import { esc, $, $$ } from '../ui.js';

export function renderHelp(el, d) {
  el.innerHTML = `
    <div class="help-tabs mb">
      <button class="btn btn-sm tab-btn on" data-tab="rules">比赛规则</button>
      <button class="btn btn-sm tab-btn" data-tab="player">参赛队员须知</button>
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
  show('rules');
}

const DOCS = {
  rules: `
    <div class="panel corner">
      <div class="phead"><h2>杜博夫系统比赛规则</h2><span class="sub">SWISS · 5.1 / 5.3</span></div>

      <h3 class="amber mt">5.1 每轮对阵生成流程</h3>
      <ol class="doc-list">
        <li>计算每位选手的 <b>ARO</b>（已交手对手的平均等级分）：<br>
          <span class="mono">ARO = ( k<sub>1</sub>R<sub>1</sub> + k<sub>2</sub>R<sub>2</sub> + … + k<sub>n</sub>R<sub>n</sub> ) / n</span><br>
          其中 i 为当前轮数，R<sub>i</sub> 指其第 i 轮对手的 ARO，n 为已进行的轮数总数，k 为荣誉系数（通常为 1，详见 5.3.2）。</li>
        <li>按当前积分分组（胜 = 3，平 = 1，负 = 0）。</li>
        <li>每组按 ARO <b>从低到高</b>排序。</li>
        <li>低 ARO 配组内最高等级分，次低配次高（折叠配对）。</li>
        <li>若某组人数为奇数，从下一低分组上调等级分最高者（见 5.3.1）。</li>
        <li>生成对阵后<b>随机分配批次</b>。</li>
      </ol>

      <h3 class="amber mt">5.3.1 等级分调整</h3>
      <p class="doc-list">按照组别从最高到最低（同积分组按照本组 ARO 大小决定顺序）依序选取（不论有多少个奇数组），若某组人数为奇数，则从下一低分组上调等级分最高者；若此举导致下一组别变为奇数人对阵则继续进行此条目，直至有组别出现偶数组或选取至最后一组。</p>
      <p class="doc-list">在选取至最后一组的情况下，使 ARO 最低的组别轮空，其本轮 ARO 计算为<b>除本组外剩余对手 ARO 平均分</b>。</p>

      <h3 class="amber mt">5.3.2 荣誉系数</h3>
      <ul class="doc-list">
        <li>对于被<b>上调</b>组，若在本轮<b>胜利</b>，会仅为其本轮对位的 ARO 计算获得一个值为 k 的系数奖励：<span class="mono">k = 1.04<sup>n</sup></span>；若失败则 k = 1。</li>
        <li>对于被<b>下调</b>组，若在本轮<b>失败</b>，会仅为其本轮对位的 ARO 计算获得一个值为 k 的系数惩罚：<span class="mono">k = 0.97<sup>n</sup></span>；若成功则 k = 1。</li>
        <li class="dim">系统实现注：指数 n 默认取当前轮数（第 1 轮 n=1，第 2 轮 n=2…），可在「赛前设置 → 规则参数」改为固定 1 或连续上调/下调次数。</li>
      </ul>

      <h3 class="amber mt">5.3.3 首轮 ARO 计算与分组</h3>
      <p class="doc-list">首轮比赛各组的 ARO 值为<b>中期考核得分总分</b>。首轮比赛仅有一组，组内同样按照 5.1 完成匹配（若总数为奇数组则轮空 ARO 最低小组）。</p>

      <h3 class="amber mt">5.3.4 弃赛与临时不能参赛解决方案</h3>
      <ul class="doc-list">
        <li>若在某轮<b>开始 1h 前</b>提出临时无法参赛，可以申请一次<b>场次调换</b>，将本组比赛排至本轮最后一组（「我的比赛」页提交申请，管理员批准）。</li>
        <li>若在某轮<b>进行期间</b>提出无法参赛，则本轮中本组所在对战为本组<b>判负</b>。</li>
        <li>若在某轮进行期间提出<b>弃赛</b>，则本轮中本组所在对战为本组判负，同时在之后所有排序中<b>删除该组</b>。</li>
        <li>以上条款均仅在本组比赛<b>开始 30min 前</b>提出适用；未及时提出者自动判负且视情节予以警告及退赛处理。</li>
      </ul>

      <h3 class="amber mt">5.3.5 禁止重复</h3>
      <p class="doc-list">若任意出现已经对位过的组别再次匹配的情况，则将其中 ARO 较高者<b>下调</b>至下一组别，将其中 ARO 较低者<b>上调</b>至上一组别（若产生奇数组别则再次适用 5.3.1 规则）。</p>

      <h3 class="amber mt">5.3.6 重赛（2026-10-22 增补）</h3>
      <p class="doc-list">某一局因故无法产生有效结果时，在该轮确认前对该局点「<b>↺ 重赛</b>」并选择：</p>
      <ul class="doc-list">
        <li><b>本轮立刻重赛</b>：清除该局已录结果，当场重赛并重新录入，本轮照常确认结算。</li>
        <li><b>下轮再重赛</b>（管理员）：优先保障赛程——本轮该局<b>按平局计</b>（各 +1 分，ARO 项=对手 ARO），照常确认并生成下一轮；下一轮该两队<b>强制再次对位</b>（豁免 5.3.5，不参与上调/下调与荣誉系数），该局结果即重赛结果。</li>
        <li>已确认轮次出争议：由管理员撤销至确认前再处理。</li>
      </ul>

      <h3 class="amber mt">5.3.7 停赛与补位替补（2026-10-22 增补）</h3>
      <ul class="doc-list">
        <li><b>停赛</b>（对阵行队伍名旁「⏸」，管理员）：等同<b>移除该队</b>——本轮对位已生成时该局<b>判对手胜</b>（未录入的对局自动判负标记；已录结果保留），后续轮次不再参与；历史成绩与 ARO 账目不变。</li>
        <li><b>补位替补</b>：停赛致可赛队伍为奇数时，在本轮对阵页录入替补新队伍<b>保证无轮空</b>；替补默认全负（0 分），初始 ARO 记入场轮在赛队伍 ARO 的<b>中位数</b>（系统预填、可微调）。未补位时按 5.3.1 轮空。</li>
      </ul>
    </div>

    <div class="panel corner">
      <div class="phead"><h2>赛程安排</h2><span class="sub">3 DAYS · 6 ROUNDS</span></div>
      <p class="hint mb">共 3 天 6 轮，每轮 16 批（前 10 批 + 后 6 批）；轮间 15 分钟配对窗口由组委会完成「确认本轮 + 生成下一轮对阵」。</p>
      <table class="grid">
        <thead><tr><th>时间段</th><th>第1天</th><th>第2天</th><th>第3天</th></tr></thead>
        <tbody>
          <tr><td><b>上午</b> 9:00–12:00</td><td>第1轮 前10批</td><td>第3轮 前10批</td><td>第5轮 前10批</td></tr>
          <tr><td><b>午饭</b> 12:00–13:00</td><td>休息</td><td>休息</td><td>休息</td></tr>
          <tr><td><b>下午</b> 13:00–14:44</td><td>第1轮 后6批</td><td>第3轮 后6批</td><td>第5轮 后6批</td></tr>
          <tr><td><b>配对</b> 14:44–14:59</td><td>第1轮结束，配对第2轮</td><td>第3轮结束，配对第4轮</td><td>第5轮结束，配对第6轮</td></tr>
          <tr><td><b>下午</b> 14:59–17:59</td><td>第2轮 前10批</td><td>第4轮 前10批</td><td>第6轮 前10批</td></tr>
          <tr><td><b>晚饭</b> 18:00–19:00</td><td>休息</td><td>休息</td><td>休息</td></tr>
          <tr><td><b>晚上</b> 19:00–20:44</td><td>第2轮 后6批</td><td>第4轮 后6批</td><td>第6轮 后6批</td></tr>
          <tr><td><b>结束</b></td><td>20:44</td><td>20:44</td><td>20:44（统计排名）</td></tr>
        </tbody>
      </table>
    </div>`,

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
        <li><b>我的比赛</b>：本队排名、积分、ARO、本轮对阵（对手与局号）。</li>
        <li><b>瑞士轮 / 淘汰赛 / 排名大屏</b>：全程只读围观，所有对阵与排名实时更新。</li>
      </ul>
      <h3 class="amber mt">3. 能申请什么（条款 5.3.4）</h3>
      <ul class="doc-list">
        <li><b>申请场次调换</b>：轮次开始前提出，批准后本队本轮对局排至<b>最后一局</b>。本轮结果已录入后不可调换。</li>
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
        <li>「瑞士轮」页确认局号与对阵（对阵由管理员生成，裁判无权生成/重排）。每局<b>左红右蓝</b>，场地以局号为准：局 01–16 在 A 场、局 17 起在 B 场。</li>
        <li>每局对局点 <b>胜 / 平 / 胜</b> 三个按钮中的一边：<b>左边 = 红方、右边 = 蓝方</b>（队伍名旁有红/蓝方章）。录错可随时重按覆盖，或点该场右侧的「<b>↺ 重赛</b>」清除已录结果，<b>确认前</b>均可修改。</li>
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
