// 三天赛程 · 批次时间窗（风格参照赛程表：轮次→天，批次前/后段→时间窗）
// 每轮批次数随对阵数变化，按原「前10:后6」（10/16 : 6/16）比例切分：
//   单数轮（第1/3/5轮，上午场日）：前段=上午 9:00–12:00，后段=下午 13:00–14:44
//   双数轮（第2/4/6轮，下午场日）：前段=下午 14:59–17:59，后段=晚上 19:00–20:44
export function batchWindow(round, board, total) {
  const day = Math.ceil(round / 2);
  const split = Math.max(1, Math.ceil((total || 16) * 10 / 16));
  const first = board <= split;
  let time;
  if (round % 2 === 1) time = first ? '上午 9:00–12:00' : '下午 13:00–14:44';
  else time = first ? '下午 14:59–17:59' : '晚上 19:00–20:44';
  return { day: `第${day}天`, time, split };
}

// 该轮两个时间窗的文字说明（导出卡/对阵页共用）
export function windowSummary(round, total) {
  const split = Math.max(1, Math.ceil((total || 16) * 10 / 16));
  return `前 ${split} 批 ${batchWindow(round, 1, total).time} · 后 ${total - split} 批 ${batchWindow(round, total, total).time}`;
}
