// API 调用 + 会话头 + Toast
const SESSION_KEY = 'dubov_session';

export function getSession() {
  return localStorage.getItem(SESSION_KEY) || '';
}
export function setSession(token) {
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export async function api(method, url, body) {
  const token = getSession();
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* 非 JSON 响应（CSV 等） */ }
  if (res.status === 401) {
    setSession('');
    window.dispatchEvent(new CustomEvent('dubov:need-login', { detail: data.error || '需要登录' }));
  }
  if (!res.ok || data.ok === false) {
    toast(data.error || `请求失败 (${res.status})`, true);
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function loginRequest(name, password) {
  return fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  });
}

export async function logoutRequest() {
  const token = getSession();
  if (token) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: '{}',
    }).catch(() => {});
  }
  setSession('');
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
