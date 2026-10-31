// 三天赛程 · 详细批次表（曼波 2026-10-22 定稿：每轮固定 16 批，打散上午+下午）
//   批次节拍：每 19 分钟一批，打 9 分钟歇 10 分钟
//   单数轮（第1/3/5轮）：批次 1–10 = 上午 09:00–12:00；批次 11–16 = 下午 13:00–14:44
//   双数轮（第2/4/6轮）：批次 1–10 = 下午 14:59–17:59；批次 11–16 = 晚上 19:00–20:44
//   64 队 = 每轮 32 局 → 每批并行 2 局（board→批次 = (board-1)%16+1）
//   全局顺延：settings.scheduleOffsetMin（分钟）整体后移所有批次（现场延误用，可调回 0）

const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// 单个批次的开止时刻（round: 1-6, batch: 1-16, offsetMin: 全局顺延分钟）
export function batchSlot(round, batch, offsetMin = 0) {
  const first = batch <= 10;
  const base = round % 2 === 1 ? (first ? 9 * 60 : 13 * 60) : (first ? 14 * 60 + 59 : 19 * 60);
  const idx = first ? batch - 1 : batch - 11;
  const start = base + idx * 19 + (Number(offsetMin) || 0);
  return { start: fmt(start), end: fmt(start + 9), day: `第${Math.ceil(round / 2)}天`, seg: first ? '前段' : '后段' };
}

// 局次 → 批次与时间窗（board: 1..N 局，total: 总局数）
export function batchWindow(round, board, total, offsetMin = 0) {
  const batch = ((board - 1) % 16) + 1;
  const slot = batchSlot(round, batch, offsetMin);
  return {
    ...slot,
    batch,
    parallel: total > 16 ? Math.ceil(total / 16) : 1, // 每批并行局数
    label: `批次${String(batch).padStart(2, '0')} ${slot.start}–${slot.end}`,
  };
}

// 场地：局 01–16 = A 场，局 17 起 = B 场（两场地并行开打，每批各一局；
// ≤16 局时仅 A 场）。同一批次的 A/B 两局同时段分头进行。
export function venueOf(board, total) {
  const isA = total <= 16 || board <= 16;
  return { key: isA ? 'A' : 'B', name: isA ? 'A 场' : 'B 场' };
}

// 该轮时间窗概览（对阵页/导出卡顶部用）
export function windowSummary(round, total, offsetMin = 0) {
  const par = total > 16 ? `（每批并行 ${Math.ceil(total / 16)} 局）` : '';
  const s = (b) => batchSlot(round, b, offsetMin);
  const off = Number(offsetMin) ? ` · 已整体顺延 ${offsetMin} 分钟` : '';
  return `16 批${par}：批次01 ${s(1).start} 起 · 批次10 ${s(10).end} 止 · 批次11 ${s(11).start} 起 · 批次16 ${s(16).end} 止（第${Math.ceil(round / 2)}天）${off}`;
}

// 全部 16 批时间表（导出卡附表用）
export function fullTimetable(round, offsetMin = 0) {
  return Array.from({ length: 16 }, (_, i) => {
    const batch = i + 1;
    const slot = batchSlot(round, batch, offsetMin);
    return { batch, start: slot.start, end: slot.end, seg: slot.seg };
  });
}

// 淘汰赛节拍（10-30 曼波定）：09:30 起，每场 BO3 计 30 分钟 + 场间 2 分钟，
// A / B 两组同槽并行；与午休 12:30–13:30 相交的场次整体顺延到 13:30 开。
// n = 组内第几场（每组各自计数，两组槽位一一对应）
export function knockoutSlot(n) {
  const LEN = 30, GAP = 2, FIRST = 9 * 60 + 30, LUNCH = [12 * 60 + 30, 13 * 60 + 30];
  let start = FIRST;
  let lunchSkipped = false;
  for (let i = 1; i < n; i++) {
    start += LEN + GAP;
    if (start < LUNCH[1] && start + LEN > LUNCH[0]) { start = LUNCH[1]; lunchSkipped = true; }
  }
  return { no: n, start: fmt(start), end: fmt(start + LEN), lunchSkipped };
}
