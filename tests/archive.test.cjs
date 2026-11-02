const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ TextEncoder, locale: 'zh' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/archive.js'), 'utf8'), ctx);
const build = (overrides = {}) => {
  ctx.values = { name: '资料', directory: 'C:\\Work', format: '7z', level: '5', encrypt: false, password: '', confirm: '', encryptNames: true, ...overrides };
  return JSON.parse(JSON.stringify(vm.runInContext("archiveRequest(values, ['C:\\\\Work\\\\资料'])", ctx)));
};
test('archive options normalize the format and exclude disabled password fields', () => {
  assert.deepEqual(build({ name: '归档.ZIP', password: 'unused', confirm: 'unused' }), { sources: ['C:\\Work\\资料'], directory: 'C:\\Work', name: '归档.7z', format: '7z', level: 5, password: '', encryptNames: false });
  assert.equal(build({ name: '归档.tar', format: 'zip', level: '0' }).name, '归档.tar.zip');
});
test('encryption keeps exact Unicode and spaces; file name encryption is 7z-only', () => {
  const encrypted = { encrypt: true, password: '  测试🔒-phrase ', confirm: '  测试🔒-phrase ' };
  assert.equal(build(encrypted).password, encrypted.password);
  assert.equal(build(encrypted).encryptNames, true);
  assert.throws(() => build({ ...encrypted, format: 'zip' }), /ZIP/);
  assert.equal(build({ ...encrypted, password: 'ASCII pass!92', confirm: 'ASCII pass!92', format: 'zip' }).encryptNames, false);
  assert.equal(build({ ...encrypted, password: 'x'.repeat(99), confirm: 'x'.repeat(99), format: 'zip' }).password.length, 99);
  assert.throws(() => build({ ...encrypted, password: 'x'.repeat(100), confirm: 'x'.repeat(100), format: 'zip' }), /99/);
});
test('invalid or mismatched encryption and unsafe output names cannot be submitted', () => {
  for (const values of [{ encrypt: true }, { encrypt: true, password: 'a', confirm: 'b' }, { name: '../outside' }, { name: '' }, { directory: '' }, { format: 'rar' }, { level: '99' }, { encrypt: true, password: 'x\ny', confirm: 'x\ny' }, { name: '长'.repeat(100) }]) assert.throws(() => build(values));
});
