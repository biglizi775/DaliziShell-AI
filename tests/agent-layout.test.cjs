const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../ui/agent-layout.js'), 'utf8');
const context = vm.createContext({ store: { get: (_, value) => value }, window: { innerWidth: 1280, innerHeight: 800 } });
vm.runInContext(source, context);
const bounds = (raw, width, height) => { context.raw = raw; context.w = width; context.h = height; return vm.runInContext('agentWindowBounds(raw, w, h)', context); };
test('floating conversation bounds recover invalid preferences and remain reachable after a viewport shrink', () => {
  const normal = bounds({ width: NaN, height: Infinity, x: NaN, y: -500 }, 1280, 800);
  assert.equal(normal.width, 396); assert.equal(normal.height, 764); assert.equal(normal.y, 12);
  const small = bounds({ x: 1200, y: 700, width: 560, height: 760 }, 960, 560);
  assert.ok(small.x >= 12 && small.y >= 12);
  assert.ok(small.x + small.width <= 948 && small.y + small.height <= 548);
  const minimum = bounds({ x: -1, y: -1, width: 2, height: 3 }, 960, 560);
  assert.equal(minimum.width, 320); assert.equal(minimum.height, 420);
});
