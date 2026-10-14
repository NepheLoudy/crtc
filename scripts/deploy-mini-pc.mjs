'use strict';
// 一键部署到小电脑（DESKTOP-FE1MIGI）
// 用法：
//   node scripts/deploy-mini-pc.mjs [--host 26.6.74.79] [--port 22] [--user mechax] [--pass XXX]
// 默认走 Radmin mesh；笔记本与小电脑同处 192.168.31.x 内网时可用 --host 192.168.31.57
// 步骤：打包(排除 node_modules/data/.git) → SFTP 推送 → 远端解压 → pm2 重启 → 健康检查
// 依赖：ssh2（项目 devDependency，npm install 即可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require2 = createRequire(import.meta.url);
// ssh2 为项目 devDependency；本地未安装时回退旧笔记本路径（历史兼容）
let Client;
try {
  ({ Client } = require2('ssh2'));
} catch {
  ({ Client } = require2('C:/Users/0d00/Desktop/qianli/approval-bot/node_modules/ssh2'));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 小电脑默认 shell 是 Git Bash：SSH 命令用 POSIX 路径，SFTP 用 Windows 路径
const REMOTE_DIR_SSH = '/c/qianli/dubov-tournament';
const REMOTE_DIR_SFTP = 'C:/qianli/dubov-tournament';
const REMOTE_APP = 'dubov-tournament';
const PORT_ENV = process.env.MINI_PC_PORT || '8321';

// 参数
const argv = process.argv.slice(2);
const opt = (k, dflt) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const HOST = opt('host', '26.6.74.79');
const PORT = Number(opt('port', '22'));
const USER = opt('user', 'mechax');
const PASS = opt('pass', process.env.MINI_PC_PASS || undefined);

const log = (m) => console.log(`[deploy] ${m}`);
const die = (m) => { console.error(`[deploy] ✗ ${m}`); process.exit(1); };

function pack() {
  log('打包项目（工作区，排除 node_modules/data/.git）…');
  // 相对路径输出：GNU tar 会把绝对路径里的 C: 当成远程主机
  execSync(
    `tar -cf dubov-deploy.tar --exclude node_modules --exclude data --exclude .git --exclude "*.tar" .`,
    { cwd: ROOT, stdio: 'inherit' },
  );
  const tar = path.join(ROOT, 'dubov-deploy.tar');
  const size = (fs.statSync(tar).size / 1024 / 1024).toFixed(1);
  log(`打包完成: ${size} MB（远端 node_modules 缺失时将自动 npm install）`);
  return tar;
}

// 认证：--pass 密码优先，否则尝试 ~/.ssh 默认私钥（id_ed25519 / id_rsa）
function sshAuth() {
  if (PASS) return { password: PASS };
  for (const keyFile of ['id_ed25519', 'id_rsa']) {
    const p = path.join(os.homedir(), '.ssh', keyFile);
    if (fs.existsSync(p)) {
      log(`使用私钥认证: ~/.ssh/${keyFile}`);
      return { privateKey: fs.readFileSync(p, 'utf8') };
    }
  }
  die('未提供 --pass 且找不到 ~/.ssh 私钥（id_ed25519 / id_rsa）');
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn))
      .on('error', (e) => reject(new Error(`SSH 连接失败: ${e.message}（小电脑在线吗？mesh IP 变了吗？先看笔记本 Radmin GUI 成员列表）`)))
      .connect({
        host: HOST, port: PORT, username: USER,
        ...sshAuth(), readyTimeout: 20000, keepaliveInterval: 5000,
      });
  });
}

function run(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('close', (code) => resolve({ code, out }))
        .on('data', (d) => { out += d; })
        .stderr.on('data', (d) => { out += d; });
    });
  });
}

async function main() {
  const tar = pack();
  log(`连接 ${USER}@${HOST}:${PORT} …`);
  const conn = await connect();
  log('已连接');

  const remoteTar = `${REMOTE_DIR_SFTP}/deploy.tar`;
  // 建目录（远端 bash）
  const mk = await run(conn, `mkdir -p ${REMOTE_DIR_SSH}`);
  if (mk.code !== 0) die(`远端建目录失败: ${mk.out}`);

  // SFTP 推送
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const wr = sftp.createWriteStream(remoteTar, { highWaterMark: 512 * 1024 });
      wr.on('error', reject).on('close', resolve);
      fs.createReadStream(tar).pipe(wr);
    });
  });
  log('tar 已推送');

  // 远端解压 + 安装依赖（首装时）
  const setup = await run(conn, [
    `cd ${REMOTE_DIR_SSH}`,
    `tar -xf deploy.tar`,
    `rm -f deploy.tar`,
    `if [ ! -d node_modules ]; then npm install --omit=dev --no-audit --no-fund; else echo "node_modules 已存在，跳过安装"; fi`,
  ].join(' && '));
  log(`远端准备:\n${setup.out.trim().split('\n').slice(-6).join('\n')}`);
  if (setup.code !== 0) die(`远端准备失败:\n${setup.out.slice(-800)}`);

  const start = await run(conn, `cd ${REMOTE_DIR_SSH} && pm2 delete ${REMOTE_APP} 2>/dev/null; PORT=${PORT_ENV} pm2 start server/index.js --name ${REMOTE_APP} --time && pm2 save`);
  if (start.code !== 0) die(`pm2 启动失败:\n${start.out.slice(-800)}`);
  log(`pm2 已启动: ${REMOTE_APP} (端口 ${PORT_ENV})`);

  await new Promise((r) => setTimeout(r, 2500));
  const health = await run(conn, `curl -s -m 4 http://localhost:${PORT_ENV}/api/state`);
  if (!health.out.includes('hasTournament')) die(`健康检查失败: ${health.out.slice(0, 200)}`);
  log('健康检查 ✓（远端本机可访问）');

  const acc = await run(conn, `cd ${REMOTE_DIR_SSH} && node scripts/user.mjs list`);
  log(`账号列表:\n${acc.out.trim()}`);

  conn.end();
  fs.rmSync(tar, { force: true });
  console.log(`\n✓ 部署完成: http://${HOST}:${PORT_ENV}  （局域网其他设备用小电脑内网 IP: http://192.168.31.57:${PORT_ENV}）`);
  console.log('  账号管理（在小电脑上执行）:');
  console.log(`    cd ${REMOTE_DIR_SFTP}`);
  console.log('    node scripts/user.mjs add <用户名> <密码> referee');
  console.log('    node scripts/user.mjs list');
  process.exit(0);
}

main().catch((e) => die(e.message));
