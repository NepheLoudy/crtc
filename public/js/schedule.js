// 三天赛程 · 详细批次表（曼波 2026-10-22 定稿：每轮固定 16 批，打散上午+下午）
//   批次节拍：每 19 分钟一批，打 9 分钟歇 10 分钟
//   单数轮（第1/3/5轮）：批次 1–10 = 上午 09:00–12:00；批次 11–16 = 下午 13:00–14:44
//   双数轮（第2/4/6轮）：批次 1–10 = 下午 14:59–17:59；批次 11–16 = 晚上 19:00–20:44
//   64 队 = 每轮 32 台 → 每批并行 2 场（board→批次 = (board-1)%16+1）

const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// 单个批次的开止时刻（round: 1-6, batch: 1-16）
export function batchSlot(round, batch) {
  const first = batch <= 10;
  const base = round % 2 === 1 ? (first ? 9 * 60 : 13 * 60) : (first ? 14 * 60 + 59 : 19 * 60);
  const idx = first ? batch - 1 : batch - 11;
  const start = base + idx * 19;
  return { start: fmt(start), end: fmt(start + 9), day: `第${Math.ceil(round / 2)}天`, seg: first ? '前段' : '后段' };
}

// 台次 → 批次与时间窗（board: 1..N 台，total: 总台数）
export function batchWindow(round, board, total) {
  const batch = ((board - 1) % 16) + 1;
  const slot = batchSlot(round, batch);
  return {
    ...slot,
    batch,
    parallel: total > 16 ? Math.ceil(total / 16) : 1, // 每批并行场数
    label: `批次${String(batch).padStart(2, '0')} ${slot.start}–${slot.end}`,
  };
}

// 场地：台 01–16 = A 场，台 17 起 = B 场（两场地并行开打，每批各一场；
// ≤16 台时仅 A 场）。同一批次的 A/B 两场同时段分头进行。
export function venueOf(board, total) {
  const isA = total <= 16 || board <= 16;
  return { key: isA ? 'A' : 'B', name: isA ? 'A 场' : 'B 场' };
}

// 该轮时间窗概览（对阵页/导出卡顶部用）
export function windowSummary(round, total) {
  const par = total > 16 ? `（每批并行 ${Math.ceil(total / 16)} 场）` : '';
  const s = (b) => batchSlot(round, b);
  return `16 批${par}：批次01 ${s(1).start} 起 · 批次10 ${s(10).end} 止 · 批次11 ${s(11).start} 起 · 批次16 ${s(16).end} 止（第${Math.ceil(round / 2)}天）`;
}

// 全部 16 批时间表（导出卡附表用）
export function fullTimetable(round) {
  return Array.from({ length: 16 }, (_, i) => {
    const batch = i + 1;
    const slot = batchSlot(round, batch);
    return { batch, start: slot.start, end: slot.end, seg: slot.seg };
  });
}
