// API 调用 + Toast
export async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
  if (!res.ok || data.ok === false) {
    toast(data.error || `请求失败 (${res.status})`, true);
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export function toast(msg, isErr = false) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' err' : ''}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 420);
  }, isErr ? 5000 : 2600);
}
