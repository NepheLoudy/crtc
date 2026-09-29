'use strict';
// 杜博夫赛事系统 服务入口
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './store.js';
import { createApiRouter } from './api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8321;

load();

const app = express();
app.use(express.json({ limit: '2mb' }));

// 本地字体（fontsource），装完依赖即可完全离线运行
app.use('/vendor/fontsource', express.static(path.join(ROOT, 'node_modules', '@fontsource')));

app.use(express.static(path.join(ROOT, 'public')));
app.use('/api', createApiRouter());

// SPA 兜底
app.get(/^\/(?!api|vendor).*/, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⚔ 杜博夫赛事系统已就绪`);
  console.log(`  本机:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  局域网: http://${net.address}:${PORT}   (${name})`);
      }
    }
  }
  console.log('');
});
