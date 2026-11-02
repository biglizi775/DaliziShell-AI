const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../ui/ai.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const plan = (root = 'C:\\work', actions = [{ kind: 'mkdir', target: root + '\\new' }]) => ({ id: 'plan-1', root, summary: 'Create a folder', actions, contextCount: 2, contextTruncated: false, permissionMode: 'confirm' });
function harness(handler = async () => undefined, initial = {}) {
  const calls = [], saved = [], refreshes = [], notices = [], fields = new Map();
  let id = 0;
  const el = (value = '') => ({ value, checked: false, disabled: false, open: false, hidden: false, type: 'password', attributes: {}, innerHTML: '', textContent: '', scrollTop: 0, scrollHeight: 100, clientHeight: 100, classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; }, showModal() { this.open = true; }, close() { this.open = false; } });
  const get = (key) => { if (!fields.has(key)) fields.set(key, el()); return fields.get(key); };
  for (const [key, value] of Object.entries({ aiEndpoint: 'https://example.test/v1', aiModel: 'model', aiKey: 'session-secret', aiPrompt: 'Organize my files' })) fields.set(key, el(value));
  const panel = { querySelector: get, querySelectorAll: () => [], classList: { toggle() {} } };
  const context = vm.createContext({
    locale: 'en', panel, $: get, URL, TextEncoder, toast: (message) => notices.push(message), crypto: { randomUUID: () => `message-${++id}` },
    store: { get: (key, fallback) => initial[key] ?? fallback, set: (key, value) => saved.push({ key, value }) },
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return handler(cmd, args); },
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    state: { tabs: [{}], tab: 0, path: 'C:\\work', entries: [{ name: 'notes.md' }], selection: new Set(['notes.md']), loading: false },
    curTab: () => context.state.tabs[context.state.tab], isTermTab: () => false, refresh: async () => refreshes.push(context.state.path),
    basename: (p) => p.split('\\').pop(), document: { body: { classList: { toggle() {} } } },
  });
  vm.runInContext(source, context);
  vm.runInContext("aiPanel = panel; aiSettings = { endpoint: 'https://example.test/v1', model: 'model' }; aiSessionKey = 'session-secret'; aiCurrentKey = aiSessionKeyFor(state.path); aiSessionFor(state.path);", context);
  return { context, fields, calls, saved, refreshes, notices, get, run: (code) => vm.runInContext(code, context) };
}

test('API settings save no key or conversation and never issue a model request', () => {
  const h = harness(); h.run('saveAiSettings()');
  assert.equal(h.calls.length, 0); assert.equal(JSON.stringify(h.saved).includes('session-secret'), false);
  assert.deepEqual(Object.keys(h.saved[0].value).sort(), ['endpoint', 'model']);
  assert.deepEqual(h.notices, ['API settings saved.']);
});
test('startup restores saved reasoning models and formats before opening the settings UI', () => {
  const h = harness(undefined, { aiModelPresets: [
    { endpoint: 'https://example.test/v1', model: 'legacy', apiDialect: 'openai', reasoningEffort: 'high' },
    { endpoint: 'https://example.test/v1', model: 'new', apiFormat: 'openai-responses', apiDialect: 'openai', apiKey: 'do-not-store' },
  ] });
  assert.equal(h.run('aiModelPresets.length'), 2);
  assert.equal(h.run('aiModelPresets[1].apiFormat'), 'openai-responses');
  assert.doesNotMatch(h.run('JSON.stringify(aiModelPresets)'), /do-not-store/);
});

test('API formats resolve base/full URLs and reject mismatched paths', () => {
  const h = harness();
  for (const [format, endpoint, expected] of [
    ['openai-completions', 'https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'],
    ['openai-responses', 'https://example.test/v1', 'https://example.test/v1/responses'],
    ['anthropic-messages', 'https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1/messages'],
    ['anthropic-messages', 'https://example.test/v1/messages', 'https://example.test/v1/messages'],
  ]) {
    h.get('aiApiFormat').value = format; h.get('aiEndpoint').value = endpoint;
    assert.equal(h.run('updateAiSettingsForm().requestUrl'), expected);
  }
  h.get('aiEndpoint').value = 'https://example.test/v1/responses';
  assert.equal(h.run('saveAiSettings()'), false);
});
test('API testing uses draft settings without saving or sending workspace context', async () => {
  const pending = deferred(), h = harness(() => pending.promise); h.run('toggleAiSettings(true)');
  h.get('aiApiFormat').value = 'openai-responses';
  const job = h.run('testAiConnection()'); await h.run('testAiConnection()');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].cmd, 'ai_test_connection');
  const request = h.calls[0].args.request;
  assert.equal(request.apiFormat, 'openai-responses'); assert.equal(request.apiKey, 'session-secret');
  assert.deepEqual(Object.keys(request).sort(), ['apiFormat', 'apiKey', 'endpoint', 'model', 'requestId']);
  assert.equal(h.saved.length, 0); assert.equal(h.run('aiSettings.apiFormat'), undefined);
  pending.resolve({ elapsedMs: 50, model: 'model', requestUrl: 'https://example.test/v1/responses' }); await job;
  assert.match(h.get('aiApiTestStatus').textContent, /Test passed.*50 ms/);
});
test('changing test settings or closing settings invalidates and cancels late test results', async () => {
  for (const action of ['update', 'close']) {
    const pending = deferred(), h = harness((cmd) => cmd === 'ai_test_connection' ? pending.promise : undefined);
    h.run('toggleAiSettings(true)'); const job = h.run('testAiConnection()');
    if (action === 'close') h.run('toggleAiSettings(false)');
    else { h.get('aiModel').value = 'new-model'; h.run('updateAiSettingsForm()'); }
    assert.ok(h.calls.some(c => c.cmd === 'ai_cancel'));
    pending.resolve({ elapsedMs: 5, model: 'old', requestUrl: 'old' }); await job;
    assert.equal(h.get('aiApiTestStatus').textContent, '');
    assert.equal(h.saved.length, 0);
  }
});
test('API test errors are visible with keys redacted and can be retried', async () => {
  const h = harness(async () => { throw Error('HTTP 401 session-secret'); }); h.run('toggleAiSettings(true)');
  await h.run('testAiConnection()');
  assert.match(h.get('aiApiTestStatus').textContent, /HTTP 401/); assert.doesNotMatch(h.get('aiApiTestStatus').textContent, /session-secret/);
  assert.equal(h.get('[data-ai-action="test-api"]').disabled, false);
  await h.run('testAiConnection()'); assert.equal(h.calls.length, 2);
});

test('settings validate transport, credentials and byte limits before changing live configuration', () => {
  const h = harness(); h.run('toggleAiSettings(true)');
  h.get('aiEndpoint').value = 'http://remote.example/v1'; h.get('aiModel').value = '';
  assert.equal(h.run('saveAiSettings()'), false);
  assert.equal(h.get('aiSettingsPanel').open, true); assert.match(h.get('aiEndpointError').textContent, /HTTPS/);
  assert.equal(h.get('aiEndpoint').attributes['aria-invalid'], 'true'); assert.equal(h.get('aiModelError').hidden, false);
  assert.equal(h.run('aiSettings.endpoint'), 'https://example.test/v1'); assert.equal(h.saved.length, 0); assert.equal(h.calls.length, 0);
  for (const endpoint of ['https://user:secret@example.test/v1', 'https://example.test/v1?api-key=secret', 'https://example.test/v1#frag', 'https://example.test/v1?', 'not a url']) {
    h.get('aiEndpoint').value = endpoint; assert.equal(h.run('saveAiSettings()'), false, endpoint);
  }
  h.get('aiEndpoint').value = 'http://127.0.0.1:11434/v1'; h.get('aiModel').value = '😀'.repeat(65);
  assert.equal(h.run('saveAiSettings()'), false); assert.match(h.get('aiModelError').textContent, /256 bytes/);
  h.get('aiModel').value = 'local-model'; h.get('aiKey').value = 'bad\nkey'; assert.equal(h.run('saveAiSettings()'), false);
  h.get('aiKey').value = ''; assert.equal(h.run('saveAiSettings()'), true);
  assert.equal(h.get('aiSettingsPanel').open, false); assert.equal(h.run('aiSessionKey'), ''); assert.equal(h.calls.length, 0);
});

test('settings show the effective endpoint; cancelling discards drafts and preserves active requests', () => {
  const h = harness(); h.run("aiCurrentSession().requestId = 'active-request'; toggleAiSettings(true)");
  assert.equal(h.get('aiRequestUrl').textContent, 'https://example.test/v1/chat/completions');
  assert.equal(h.get('[data-ai-action="save-settings"]').disabled, true);
  h.get('aiEndpoint').value = 'http://[::1]:11434/v1/chat/completions'; h.get('aiKey').value = 'unsaved-secret'; h.run('updateAiSettingsForm()');
  assert.equal(h.get('aiRequestUrl').textContent, 'http://[::1]:11434/v1/chat/completions');
  assert.equal(h.get('aiSettingsStatus').textContent, 'Unsaved changes');
  h.run('toggleAiSettings(false); toggleAiSettings(true)');
  assert.equal(h.get('aiEndpoint').value, 'https://example.test/v1'); assert.equal(h.get('aiKey').value, 'session-secret');
  assert.equal(h.run('aiCurrentSession().requestId'), 'active-request'); assert.equal(h.saved.length, 0); assert.equal(h.calls.length, 0);
});

test('saving changed settings cancels pending replies and expires plans without executing anything', () => {
  const h = harness(); h.run("aiCurrentSession().requestId = 'active-request'; addAiMessage(aiCurrentSession(), 'assistant', 'A proposal', { plan: { id: 'pending-plan', actions: [] }, planState: 'pending' }); toggleAiSettings(true)");
  h.get('aiModel').value = 'different-model'; assert.equal(h.run('saveAiSettings()'), true);
  assert.equal(h.run('aiCurrentSession().requestId'), null);
  assert.equal(h.run('aiCurrentSession().messages[0].planState'), 'superseded');
  assert.deepEqual(h.calls.map((call) => call.cmd), ['ai_cancel', 'ai_discard']);
  assert.equal(h.get('aiModelLabel').textContent, 'different-model');
});
test('chat sends folder scope and selection, then includes actual preceding turns', async () => {
  const h = harness(async (cmd) => cmd === 'ai_plan' ? plan() : undefined);
  await h.run('sendAiMessage()');
  const first = h.calls.find((c) => c.cmd === 'ai_plan').args.request;
  assert.equal(first.root, 'C:\\work'); assert.deepEqual([...first.selection], ['notes.md']); assert.equal(first.history.length, 0);
  assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
  h.get('aiPrompt').value = 'Use an Archive folder instead'; await h.run('sendAiMessage()');
  const second = h.calls.filter((c) => c.cmd === 'ai_plan')[1].args.request;
  assert.deepEqual(second.history.map((m) => m.role).join(','), 'user,assistant');
  assert.match(second.history[1].content, /Plan status: superseded/);
  assert.ok(h.calls.some((c) => c.cmd === 'ai_discard'));
});

test('reasoning settings persist without credentials and reach the real planning request', async () => {
  const h = harness(async (cmd) => cmd === 'ai_plan' ? plan() : undefined);
  h.run('toggleAiSettings(true)');
  h.get('aiApiDialect').value = 'openai'; h.run('refreshAiEffortField()'); h.get('aiReasoningEffort').value = 'high';
  assert.equal(h.run('saveAiSettings()'), true);
  assert.equal(h.run('aiSettings.reasoningEffort'), 'high');
  assert.equal(h.run('aiSettings.apiDialect'), 'openai');
  assert.equal(JSON.stringify(h.saved).includes('session-secret'), false);
  await h.run('sendAiMessage()');
  const request = h.calls.find((c) => c.cmd === 'ai_plan').args.request;
  assert.equal(request.apiDialect, 'openai'); assert.equal(request.reasoningEffort, 'high');
  assert.equal(h.get('aiQuickEffort').value, 'high');
});

test('provider changes reset incompatible effort; cancelling keeps the committed configuration', () => {
  const h = harness(); h.run('toggleAiSettings(true)');
  h.get('aiApiDialect').value = 'openai'; h.run('refreshAiEffortField()'); h.get('aiReasoningEffort').value = 'medium';
  h.run('saveAiSettings(); toggleAiSettings(true)');
  h.get('aiApiDialect').value = 'deepseek'; h.run('refreshAiEffortField()');
  assert.equal(h.get('aiReasoningEffort').value, 'default');
  h.get('aiReasoningEffort').value = 'medium';
  assert.equal(h.run('saveAiSettings()'), false);
  assert.match(h.get('aiReasoningEffortError').textContent, /does not support/);
  h.run('toggleAiSettings(false)');
  assert.equal(h.run('aiSettings.apiDialect'), 'openai');
  assert.equal(h.run('aiSettings.reasoningEffort'), 'medium');
});

test('quick effort changes cancel pending responses and expire plans without executing them', () => {
  const h = harness();
  h.run("aiSettings.apiDialect = 'deepseek'; aiCurrentSession().requestId = 'waiting'; addAiMessage(aiCurrentSession(), 'assistant', 'Plan', { plan: { id: 'old-plan', actions: [] }, planState: 'pending' });");
  assert.equal(h.run("changeAiQuickEffort('max')"), true);
  assert.equal(h.run('aiCurrentSession().requestId'), null);
  assert.equal(h.run('aiCurrentSession().messages[0].planState'), 'superseded');
  assert.deepEqual(h.calls.map((call) => call.cmd), ['ai_cancel', 'ai_discard']);
  assert.equal(h.run("changeAiQuickEffort('medium')"), false);
  h.run('aiCurrentSession().running = true');
  assert.equal(h.run("changeAiQuickEffort('none')"), false);
  assert.equal(h.run('aiSettings.reasoningEffort'), 'max');
});

test('saved models switch only within the current endpoint and never forward its key elsewhere', () => {
  const h = harness();
  h.run("aiModelPresets = [{ endpoint: 'https://example.test/v1', model: 'other', apiDialect: 'openai', reasoningEffort: 'low' }, { endpoint: 'https://different.test/v1', model: 'remote' }]");
  assert.equal(h.run("changeAiModelPreset('1')"), false);
  assert.equal(h.run('aiSettings.model'), 'model');
  assert.equal(h.run("changeAiModelPreset('0')"), true);
  assert.equal(h.run('aiSettings.model'), 'other'); assert.equal(h.run('aiSettings.reasoningEffort'), 'low');
  assert.equal(h.run('aiSessionKey'), 'session-secret');
  assert.equal(JSON.stringify(h.saved).includes('session-secret'), false);
});
test('folder switching preserves drafts and same-folder refresh keeps the session', () => {
  const h = harness(); h.get('aiPrompt').value = 'draft A';
  h.run("const original = aiCurrentSession(); state.path = 'D:\\\\other'; syncAiWorkspace();");
  assert.equal(h.get('aiPrompt').value, ''); h.get('aiPrompt').value = 'draft B';
  h.run("state.path = 'c:\\\\WORK'; syncAiWorkspace();");
  assert.equal(h.get('aiPrompt').value, 'draft A');
  assert.equal(h.run('aiCurrentSession() === original'), true);
  h.run('syncAiWorkspace()'); assert.equal(h.get('aiPrompt').value, 'draft A');
});
test('late reply remains with its originating folder and does not enter the current chat', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  const job = h.run('sendAiMessage()'); h.run("state.path = 'D:\\\\other'; syncAiWorkspace();");
  waiting.resolve(plan()); await job;
  assert.equal(h.run('aiCurrentSession().messages.length'), 0);
  assert.equal(h.run("aiSessions.get(aiSessionKeyFor('C:\\\\work')).messages.at(-1).role"), 'assistant');
  assert.doesNotMatch(h.get('aiMessages').innerHTML, /Create a folder/);
});
test('the working folder always follows the active tab and selection cannot leak across tabs', () => {
  const h = harness(); h.run("const firstSession = aiCurrentSession(); state.path = 'C:\\\\work\\\\child'; syncAiWorkspace();");
  assert.equal(h.run('aiCurrentSession().root'), 'C:\\work\\child');
  assert.equal(h.run('aiSelectedPaths(firstSession).length'), 0);
  assert.equal(h.run('aiSelectedPaths(aiCurrentSession())[0]'), 'notes.md');
  h.run("state.tabs.push({}); state.tab = 1; syncAiWorkspace();");
  assert.equal(h.run('aiSelectedPaths(firstSession).length'), 0);
});
test('cancelled reply is discarded and cannot create an actionable plan', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  const job = h.run('sendAiMessage()'); h.run('cancelAiRequest()'); waiting.resolve(plan()); await job;
  assert.equal(h.run("aiCurrentSession().messages.some((m) => m.planState === 'pending')"), false);
  assert.ok(h.calls.some((c) => c.cmd === 'ai_cancel')); assert.ok(h.calls.some((c) => c.cmd === 'ai_discard'));
});
test('execution needs a checked review and cannot duplicate; results stay with original folder', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? plan() : cmd === 'ai_execute' ? waiting.promise : undefined);
  await h.run('sendAiMessage()'); const id = h.run('aiCurrentSession().messages.at(-1).id');
  await h.run(`executeAiPlan('${id}')`); assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
  h.get(`[data-ai-confirm="${id}"]`).checked = true;
  const job = h.run(`executeAiPlan('${id}')`); await h.run(`executeAiPlan('${id}')`);
  h.run("state.path = 'D:\\\\other'; syncAiWorkspace();");
  waiting.resolve({ completed: true, results: [{ ...plan().actions[0], status: 'success', message: '' }] }); await job;
  assert.equal(h.calls.filter((c) => c.cmd === 'ai_execute').length, 1); assert.equal(h.refreshes.length, 0);
  assert.equal(h.run('aiCurrentSession().messages.length'), 0);
  assert.match(h.run("aiHistory(aiSessions.get(aiSessionKeyFor('C:\\\\work'))).at(-1).content"), /Local execution results/);
});
test('new conversation invalidates a pending request without accepting its late response', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  const job = h.run('sendAiMessage()'); h.run('newAiConversation()'); waiting.resolve(plan()); await job;
  assert.equal(h.run('aiCurrentSession().messages.length'), 0); assert.ok(h.calls.some((c) => c.cmd === 'ai_discard'));
});
test('history is bounded by turns and Unicode characters without splitting emoji', () => {
  const h = harness(); h.run("for(let i=0;i<24;i++) addAiMessage(aiCurrentSession(), i%2 ? 'assistant' : 'user', '😀'.repeat(9000));");
  const history = h.run('aiHistory(aiCurrentSession())');
  assert.ok(history.length <= 16); assert.ok(history.every((m) => Array.from(m.content).length <= 8000));
  assert.ok(history.reduce((sum, m) => sum + Array.from(m.content).length, 0) <= 24000);
  assert.equal(history[0].content.endsWith('😀'), true);
});
test('mismatched scope is rejected and remote text is escaped', async () => {
  const h = harness((cmd) => cmd === 'ai_plan' ? plan('D:\\outside') : undefined);
  await h.run('sendAiMessage()'); assert.equal(h.run("aiCurrentSession().messages.some((m) => m.plan)"), false);
  h.run("addAiMessage(aiCurrentSession(), 'assistant', '<img src=x onerror=alert(1)>'); renderAiConversation();");
  assert.doesNotMatch(h.get('aiMessages').innerHTML, /<img/); assert.match(h.get('aiMessages').innerHTML, /&lt;img/);
});

test('agent context is scoped to the originating folder and reported in the reply', async () => {
  const roots = [], waiting = deferred();
  const response = { ...plan(), appliedSkills: [{ id: 'skill-1', name: '<organizer>' }], memoryCount: 2, memorySuggestions: ['Use dated folders'] };
  const h = harness((cmd) => cmd === 'ai_plan' ? response : undefined);
  h.context.getAgentRequestContext = (root) => { roots.push(root); return waiting.promise; };
  const job = h.run('sendAiMessage()');
  h.run("state.path = 'D:\\\\other'; syncAiWorkspace();");
  waiting.resolve({ skillIds: ['skill-1'], useMemory: true, learnMemory: true }); await job;
  const request = h.calls.find((call) => call.cmd === 'ai_plan').args.request;
  assert.deepEqual(roots, ['C:\\work']); assert.equal(request.root, 'C:\\work');
  assert.deepEqual(request.skillIds, ['skill-1']); assert.equal(request.useMemory, true);
  assert.equal(h.run('aiCurrentSession().messages.length'), 0);
  const reply = h.run("aiSessions.get(aiSessionKeyFor('C:\\\\work')).messages.at(-1)");
  assert.equal(reply.memorySuggestions[0].status, 'pending'); assert.equal(reply.memoryCount, 2);
  assert.ok(h.run("aiMessageMarkup(aiSessions.get(aiSessionKeyFor('C:\\\\work')).messages.at(-1))").includes('&lt;organizer>'));
  assert.equal(h.calls.some((call) => call.cmd === 'agent_memory_save'), false, 'model suggestions never persist themselves');
});

test('cancelling while agent context loads prevents a late provider request', async () => {
  const waiting = deferred(), h = harness();
  h.context.getAgentRequestContext = () => waiting.promise;
  const job = h.run('sendAiMessage()'); h.run('cancelAiRequest()');
  waiting.resolve({ skillIds: ['skill-1'], useMemory: true, learnMemory: true }); await job;
  assert.equal(h.calls.some((call) => call.cmd === 'ai_plan'), false);
});

test('learning off ignores unsolicited suggestions and reviewed memory keeps its original scope', async () => {
  const h = harness((cmd) => cmd === 'ai_plan' ? { ...plan(), memorySuggestions: ['Use Chinese'] } : undefined);
  h.context.getAgentRequestContext = async () => ({ skillIds: [], useMemory: true, learnMemory: false });
  await h.run('sendAiMessage()'); assert.equal(h.run('aiCurrentSession().messages.at(-1).memorySuggestions.length'), 0);
  h.run("aiCurrentSession().messages.at(-1).memorySuggestions = [{ content: 'Use Chinese', status: 'pending' }];");
  const waiting = deferred(), edits = [];
  h.context.saveAgentSuggestedMemory = (root, content) => { edits.push({ root, content }); return waiting.promise; };
  const id = h.run('aiCurrentSession().messages.at(-1).id');
  const save = h.run(`reviewAiMemory('${id}', 0)`); await h.run(`reviewAiMemory('${id}', 0)`);
  assert.equal(edits.length, 1);
  h.run("state.path = 'D:\\\\other'; syncAiWorkspace();");
  waiting.resolve(true); await save;
  assert.deepEqual(edits, [{ root: 'C:\\work', content: 'Use Chinese' }]);
  assert.equal(h.run("aiSessions.get(aiSessionKeyFor('C:\\\\work')).messages.at(-1).memorySuggestions[0].status"), 'saved');
});

test('two tabs at the same folder have separate drafts, histories and permissions', () => {
  const h = harness();
  h.run("const tabOneSession = aiCurrentSession(); addAiMessage(tabOneSession, 'user', 'Only first tab'); setAiPermissionMode('auto');");
  h.get('aiPrompt').value = 'first draft';
  h.run('state.tabs.push({}); state.tab = 1; syncAiWorkspace();');
  assert.equal(h.run('aiCurrentSession().permissionMode'), 'confirm');
  assert.equal(h.run('aiCurrentSession().messages.length'), 0);
  assert.equal(h.get('aiPrompt').value, '');
  h.get('aiPrompt').value = 'second draft';
  h.run('state.tab = 0; syncAiWorkspace();');
  assert.equal(h.run('aiCurrentSession() === tabOneSession'), true);
  assert.equal(h.run('aiCurrentSession().permissionMode'), 'auto');
  assert.equal(h.get('aiPrompt').value, 'first draft');
});

test('read-only replies cannot offer executable changes, even if a provider returns actions', async () => {
  const h = harness((cmd) => cmd === 'ai_plan' ? { ...plan(), permissionMode: 'read-only' } : undefined);
  h.run("setAiPermissionMode('read-only')");
  await h.run('sendAiMessage()');
  assert.equal(h.calls.find((c) => c.cmd === 'ai_plan').args.request.permissionMode, 'read-only');
  assert.equal(h.run("aiCurrentSession().messages.some((m) => m.planState === 'pending')"), false);
  assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
  assert.ok(h.calls.some((c) => c.cmd === 'ai_discard'));
});

test('automatic execution requires the explicitly selected mode and records actual results', async () => {
  const h = harness((cmd) => cmd === 'ai_plan' ? { ...plan(), permissionMode: 'auto' } : cmd === 'ai_execute' ? { completed: true, results: [{ status: 'success', ...plan().actions[0] }] } : undefined);
  h.run("setAiPermissionMode('auto')"); await h.run('sendAiMessage()');
  const execution = h.calls.find((c) => c.cmd === 'ai_execute');
  assert.equal(execution.args.permissionMode, 'auto'); assert.equal(execution.args.approved, false);
  assert.equal(h.calls.filter((c) => c.cmd === 'ai_execute').length, 1);
  assert.equal(h.run('aiCurrentSession().messages.at(-2).planState'), 'done');
  assert.match(h.run('aiHistory(aiCurrentSession()).at(-1).content'), /Local execution results/);
});

test('a late auto plan does not execute after switching tabs, even when switching back', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  h.run("setAiPermissionMode('auto')"); const job = h.run('sendAiMessage()');
  h.run('state.tabs.push({}); state.tab = 1; syncAiWorkspace(); state.tab = 0; syncAiWorkspace();');
  waiting.resolve({ ...plan(), permissionMode: 'auto' }); await job;
  assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
  assert.equal(h.run('aiCurrentSession().messages.at(-1).planState'), 'pending');
});

test('changing permissions invalidates pending replies and cannot upgrade an older plan', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  const job = h.run('sendAiMessage()'); h.run("setAiPermissionMode('auto')");
  waiting.resolve(plan()); await job;
  assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
  assert.ok(h.calls.some((c) => c.cmd === 'ai_cancel'));
  assert.ok(h.calls.some((c) => c.cmd === 'ai_discard'));
});

test('closing a tab cancels its request and cannot recreate a conversation from a late response', async () => {
  const waiting = deferred(), h = harness((cmd) => cmd === 'ai_plan' ? waiting.promise : undefined);
  const job = h.run('sendAiMessage()');
  h.run('disposeAiTab(curTab()); state.tabs = [{}]; state.tab = 0; syncAiWorkspace();');
  waiting.resolve(plan()); await job;
  assert.equal(h.run('aiSessions.size'), 1);
  assert.equal(h.run('aiCurrentSession().messages.length'), 0);
  assert.equal(h.calls.some((c) => c.cmd === 'ai_execute'), false);
});

test('an SSH tab cannot reuse local folder memory, selections or executable plans', async () => {
  const h = harness();
  h.run("state.tabs.push({ kind: 'term', connection: 'ssh', cwd: 'C:\\\\wrong-local-root' }); state.tab = 1; syncAiWorkspace();");
  assert.equal(h.run('aiBrowsingFolder()'), null); assert.equal(h.run('aiCurrentSession()'), null);
  assert.equal(h.get('aiPrompt').disabled, true);
  await h.run('sendAiMessage()'); assert.equal(h.calls.some((c) => c.cmd === 'ai_plan'), false);
});
