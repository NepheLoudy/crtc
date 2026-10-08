'use strict';
// 认证：预置账号（禁止注册）+ 持久会话
// 账号管理走 scripts/user.mjs CLI；密码 scrypt 加盐哈希存储。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 会话 7 天

export const ROLES = ['admin', 'referee', 'player'];

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[auth] 读取 ${path.basename(file)} 失败:`, err.message);
  }
  return fallback;
}

function saveJson(file, obj) {
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

export function listAccounts() {
  return loadJson(ACCOUNTS_FILE, { users: [] }).users.map(({ passHash, salt, ...rest }) => rest);
}

// player 角色可绑定队伍（--team <teamId>），登录后定位「我的队伍」
export function createAccount(name, password, role = 'referee', createdBy = 'cli', teamId = null) {
  if (!ROLES.includes(role)) throw new Error(`非法角色: ${role}（可选 ${ROLES.join('/')}）`);
  const nameClean = String(name || '').trim();
  if (!nameClean) throw new Error('用户名不能为空');
  if (String(password || '').length < 4) throw new Error('密码至少 4 位');
  const db = loadJson(ACCOUNTS_FILE, { users: [] });
  if (db.users.some((u) => u.name === nameClean)) throw new Error(`用户已存在: ${nameClean}`);
  const salt = crypto.randomBytes(16).toString('hex');
  db.users.push({
    id: `u${db.users.length + 1}`,
    name: nameClean,
    role,
    teamId: role === 'player' ? (teamId || null) : null,
    salt,
    passHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
    createdBy,
  });
  saveJson(ACCOUNTS_FILE, db);
  return { name: nameClean, role, teamId: role === 'player' ? (teamId || null) : null };
}

export function removeAccount(name) {
  const db = loadJson(ACCOUNTS_FILE, { users: [] });
  const before = db.users.length;
  db.users = db.users.filter((u) => u.name !== name);
  if (db.users.length === before) throw new Error(`用户不存在: ${name}`);
  saveJson(ACCOUNTS_FILE, db);
}

export function setPassword(name, newPassword) {
  const db = loadJson(ACCOUNTS_FILE, { users: [] });
  const u = db.users.find((x) => x.name === name);
  if (!u) throw new Error(`用户不存在: ${name}`);
  if (String(newPassword || '').length < 4) throw new Error('密码至少 4 位');
  u.salt = crypto.randomBytes(16).toString('hex');
  u.passHash = hashPassword(newPassword, u.salt);
  u.passwordChangedAt = new Date().toISOString();
  saveJson(ACCOUNTS_FILE, db);
}

function checkPassword(user, password) {
  const test = hashPassword(password, user.salt);
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(user.passHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- 会话 ----------
let sessions = loadJson(SESSIONS_FILE, { sessions: [] });
let sessionsDirty = false;
function persistSessions() {
  saveJson(SESSIONS_FILE, sessions);
  sessionsDirty = false;
}

export function login(name, password) {
  const db = loadJson(ACCOUNTS_FILE, { users: [] });
  const u = db.users.find((x) => x.name === String(name || '').trim());
  // 用户不存在时也做一次哈希，拉平响应时间
  if (!u) { hashPassword(password || '', 'decoy-salt'); return null; }
  if (!checkPassword(u, password)) return null;
  const now = Date.now();
  sessions.sessions = sessions.sessions.filter((s) => s.expiresAt > now && s.userId !== u.id);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.sessions.push({ token, userId: u.id, name: u.name, role: u.role, teamId: u.teamId || null, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  sessionsDirty = true;
  persistSessions();
  return { token, user: { name: u.name, role: u.role, teamId: u.teamId || null } };
}

export function logout(token) {
  const before = sessions.sessions.length;
  sessions.sessions = sessions.sessions.filter((s) => s.token !== token);
  if (sessions.sessions.length !== before) { sessionsDirty = true; persistSessions(); }
  return true;
}

export function userForToken(token) {
  if (!token) return null;
  const s = sessions.sessions.find((x) => x.token === token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.sessions = sessions.sessions.filter((x) => x.token !== token);
    sessionsDirty = true;
    return null;
  }
  if (sessionsDirty) persistSessions();
  return { name: s.name, role: s.role, teamId: s.teamId || null };
}
