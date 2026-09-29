'use strict';
// JSON 文件持久化 + 撤销快照栈
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'tournament.json');
const MAX_SNAPSHOTS = 40;

const db = { state: null, snapshots: [] };

export function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.state = raw.state || null;
      db.snapshots = Array.isArray(raw.snapshots) ? raw.snapshots : [];
    }
  } catch (err) {
    console.error('[store] 读取数据失败，已忽略旧档:', err.message);
    db.state = null;
    db.snapshots = [];
  }
  return db.state;
}

export function get() {
  return db.state;
}

export function set(state) {
  db.state = state;
}

// 每次变更前调用：压入当前状态快照
export function snapshot(label) {
  if (!db.state) return;
  db.snapshots.push({ label, ts: new Date().toISOString(), state: structuredClone(db.state) });
  if (db.snapshots.length > MAX_SNAPSHOTS) db.snapshots.shift();
}

export function undo() {
  const snap = db.snapshots.pop();
  if (!snap) throw new Error('没有可撤销的操作');
  db.state = snap.state;
  return snap.label;
}

export function canUndo() {
  return db.snapshots.length > 0;
}

export function lastSnapshotLabel() {
  return db.snapshots.length ? db.snapshots[db.snapshots.length - 1].label : null;
}

export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ state: db.state, snapshots: db.snapshots }, null, 1), 'utf8');
  fs.renameSync(tmp, DB_FILE); // 原子替换，断电不留半截文件
}
