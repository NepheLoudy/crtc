'use strict';
// 可追溯性：操作审计日志（JSONL append-only）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_FILE = path.join(ROOT, 'data', 'audit.jsonl');

export function audit({ user = '-', role = '-', action, ok = true, error = '', ip = '-', path: p = '-' }) {
  const entry = {
    ts: new Date().toISOString(),
    user,
    role,
    action,
    ok,
    ...(error ? { error } : {}),
    ip,
    path: p,
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[audit] 写入失败:', err.message);
  }
}

// 读取最近 n 条（倒序）
export function readAudit(limit = 300) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      try { out.push(JSON.parse(lines[i])); } catch { /* 跳过坏行 */ }
    }
    return out;
  } catch {
    return [];
  }
}
