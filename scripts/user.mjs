'use strict';
// 账号管理 CLI（禁止注册，账号由管理员手工预置）
// 用法：
//   node scripts/user.mjs add <用户名> <密码> <admin|referee>
//   node scripts/user.mjs passwd <用户名> <新密码>
//   node scripts/user.mjs remove <用户名>
//   node scripts/user.mjs list
import { createAccount, removeAccount, setPassword, listAccounts } from '../server/auth.js';

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'add': {
      const [name, password, role] = args;
      const u = createAccount(name, password, role || 'referee');
      console.log(`✓ 已创建 ${u.role} 账号: ${u.name}`);
      break;
    }
    case 'passwd': {
      const [name, password] = args;
      setPassword(name, password);
      console.log(`✓ 已更新密码: ${name}`);
      break;
    }
    case 'remove': {
      removeAccount(args[0]);
      console.log(`✓ 已删除账号: ${args[0]}`);
      break;
    }
    case 'list': {
      const users = listAccounts();
      if (!users.length) { console.log('（无账号）'); break; }
      for (const u of users) {
        console.log(`${u.role.padEnd(8)} ${u.name}${u.passwordChangedAt ? '  (已改密)' : ''}`);
      }
      break;
    }
    default:
      console.log('用法:\n  node scripts/user.mjs add <用户名> <密码> <admin|referee>\n  node scripts/user.mjs passwd <用户名> <新密码>\n  node scripts/user.mjs remove <用户名>\n  node scripts/user.mjs list');
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error('✗', err.message);
  process.exit(1);
}
