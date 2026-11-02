const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (name) => fs.readFileSync(path.join(__dirname, '../ui', name), 'utf8');
function harness(handler) {
  const calls = [], storage = {}, session = { key: 'tab::folder', root: 'C:\\work', messages: [], requestId: 'request', revision: 0 };
  const context = vm.createContext({ locale: 'en', URL, TextEncoder, console,
    store: { get: (key, fallback) => storage[key] ?? fallback, set: (key, value) => { storage[key] = value; } },
    aiSessions: new Map([[session.key, session]]), aiCurrentSession: () => session,
    aiSettings: { endpoint: 'https://example.org/v1', model: 'model', apiFormat: 'openai-responses' }, aiSessionKey: 'session-secret',
    aiChars: (text, max) => [...text].slice(0, max).join(''), $: () => null,
    invoke: async (command, args) => { calls.push({ command, args }); return handler ? handler(command, args) : { summary: 'Keep user constraints; previous plans were not executed.', beforeCharacters: 800, afterCharacters: 53 }; },
    session,
  });
  vm.runInContext(source('ai-memory.js'), context);
  session.messages = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: 'Message ' + i + ' 保留重要项目约束和名称。'.repeat(15) }));
  return { session, calls, storage, context, run: (s) => vm.runInContext(s, context) };
}
test('automatic summaries retain recent original messages, keep UI history and send no folder or execution scope', async () => {
  const h = harness(); const original = structuredClone(h.session.messages);
  await h.run('prepareAiMemory(session, "request")');
  assert.deepEqual(h.session.messages, original, 'summarization does not erase the visible transcript');
  assert.equal(h.session.summarizedIds.size, 8); assert.equal(h.run('aiMemoryHistory(session).length'), 6);
  assert.equal(h.calls[0].command, 'ai_compact');
  const request = h.calls[0].args.request;
  assert.equal(request.apiFormat, 'openai-responses'); assert.equal(request.apiKey, 'session-secret');
  assert.equal(request.history.length, 8); assert.equal(request.root, undefined); assert.equal(request.permissionMode, undefined);
  assert.equal(Object.keys(h.storage).length, 0, 'chat, summary and credentials are not persisted as long-term memory');
  await h.run('prepareAiMemory(session, "request")'); assert.equal(h.calls.length, 1, 'already summarized messages are not sent again');
});
test('late summaries after cancel or tab disposal cannot overwrite the session', async () => {
  let resolve;
  const h = harness(() => new Promise((r) => { resolve = r; }));
  const pending = h.run('prepareAiMemory(session, "request")');
  h.session.requestId = null;
  resolve({ summary: 'A short summary', beforeCharacters: 1000, afterCharacters: 15 }); await pending;
  assert.equal(h.session.conversationSummary, undefined); assert.equal(h.session.summarizedIds, undefined);
  assert.equal(h.session.compacting, false);
});
test('failed or expanded summaries preserve original context and old summary for retry', async () => {
  for (const handler of [async () => { throw new Error('Service unavailable'); }, async () => ({ summary: 'x'.repeat(7000) })]) {
    const h = harness(handler); h.session.conversationSummary = 'Existing summary';
    await assert.rejects(h.run('prepareAiMemory(session, "request")'));
    assert.equal(h.session.conversationSummary, 'Existing summary'); assert.equal(h.session.summarizedIds, undefined);
    assert.equal(h.run('aiMemoryHistory(session).length'), 14);
  }
});
test('context budget handles Unicode, execution results and long messages; notices omitted', async () => {
  const h = harness(); h.session.messages = Array.from({ length: 8 }, (_, i) => ({ id: `long${i}`, role: i % 2 ? 'assistant' : 'user', text: '中'.repeat(9000) }));
  h.session.messages[0].omitHistory = true;
  await h.run('prepareAiMemory(session, "request")');
  assert.equal(h.calls.length, 2, 'older long messages are batched within the backend limit');
  for (const call of h.calls) assert.ok(call.args.request.history.reduce((n, x) => n + [...x.content].length, 0) <= 24000);
  const history = h.run('aiMemoryHistory(session)');
  assert.ok(history.reduce((n, x) => n + [...x.content].length, [...h.session.conversationSummary].length) <= 24000);
  h.context.message = { text: 'Plan', role: 'assistant', planState: 'discarded', plan: { actions: [{ kind: 'mkdir', target: 'new' }] }, results: [{ status: 'failed' }] };
  const content = h.run('aiMemoryMessage(message).content'); assert.match(content, /discarded/); assert.match(content, /not proof of execution/); assert.match(content, /failed/);
});
test('auto compaction opt-out stops network calls; explicit compaction remains possible', async () => {
  const h = harness(); h.run('saveAiMemoryPreference("autoCompact", false)');
  await h.run('prepareAiMemory(session, "request")'); assert.equal(h.calls.length, 0);
  await h.run('prepareAiMemory(session, "request", session.messages, true)'); assert.equal(h.calls.length, 1);
  assert.equal(h.run('estimateAiTokens("中文abcd")'), 3);
});
