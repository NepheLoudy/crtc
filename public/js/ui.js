// 通用工具：转义、格式化、DOM 快捷操作
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmtPts = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
export const fmtAro = (x) => (Math.round(x * 100) / 100).toFixed(2);
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

export function teamName(d, id) {
  const t = d.state?.teams.find((x) => x.id === id);
  return t ? t.name : id;
}

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
