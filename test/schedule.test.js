'use strict';
// 批次时间映射 + 全局顺延偏移（schedule.js 纯函数，Node 可直接测）
import test from 'node:test';
import assert from 'node:assert/strict';
import { batchSlot, batchWindow, venueOf, windowSummary, fullTimetable, knockoutSlot } from '../public/js/schedule.js';

test('批次基表：单数轮批01=09:00、批11=13:00；双数轮=14:59/19:00；19 分钟节拍', () => {
  assert.equal(batchSlot(1, 1).start, '09:00');
  assert.equal(batchSlot(1, 1).end, '09:09');
  assert.equal(batchSlot(1, 10).start, '11:51');
  assert.equal(batchSlot(1, 11).start, '13:00');
  assert.equal(batchSlot(1, 16).end, '14:44');
  assert.equal(batchSlot(2, 1).start, '14:59');
  assert.equal(batchSlot(2, 11).start, '19:00');
  assert.equal(batchSlot(4, 16).end, '20:44'); // 双数轮同节拍
});

test('批次/场地映射：board 17 回到批次 01 并进 B 场', () => {
  const w = batchWindow(1, 17, 32);
  assert.equal(w.batch, 1);
  assert.equal(w.start, '09:00');
  assert.equal(venueOf(17, 32).name, 'B 场');
  assert.equal(venueOf(16, 32).name, 'A 场');
});

test('全局顺延：+20 分钟后批01=09:20、批16=14:55–15:04，summary 带顺延标注', () => {
  assert.equal(batchSlot(1, 1, 20).start, '09:20');
  assert.equal(batchSlot(2, 11, 20).start, '19:20');
  assert.equal(batchSlot(1, 16, 20).end, '15:04');
  const w = batchWindow(1, 17, 32, 20);
  assert.equal(w.start, '09:20');
  const ft = fullTimetable(1, 20);
  assert.equal(ft[0].start, '09:20');
  assert.equal(ft[15].end, '15:04');
  assert.ok(windowSummary(1, 32, 20).includes('已整体顺延 20 分钟'));
});

test('淘汰赛节拍：09:00 起 29 分钟/场（BO3 计 27+歇 2），撞午休整体顺延 13:30（10-30 曼波定，30→25→27 / 9:30→9:00）', () => {
  assert.equal(knockoutSlot(1).start, '09:00');
  assert.equal(knockoutSlot(1).end, '09:27');
  assert.equal(knockoutSlot(7).start, '11:54'); // 12:21 止，午休前最后一场
  assert.equal(knockoutSlot(7).end, '12:21');
  assert.ok(!knockoutSlot(7).lunchSkipped);
  assert.equal(knockoutSlot(8).start, '13:30'); // 12:23 起会打到 12:50 → 顺延
  assert.equal(knockoutSlot(8).end, '13:57');
  assert.ok(knockoutSlot(8).lunchSkipped);
  assert.ok(!knockoutSlot(9).lunchSkipped); // 仅复场那一场标注
  assert.equal(knockoutSlot(9).start, '13:59'); // 午后恢复正常节拍
  assert.equal(knockoutSlot(14).start, '16:24');
  assert.equal(knockoutSlot(14).end, '16:51');
});
