const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/agent-profile.js'), 'utf8');
const profile = (extra = {}) => ({ skills: [], memories: [], legacyMemories: [], memoryEnabled: true, learningEnabled: false, storagePath: 'C:\\profiles\\agent.json', memoryStoragePath: 'C:\\work\\.dalizi\\agent-memory.json', ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(handler = async () => profile()) {
  const calls = [], fields = new Map(), created = [], notices = [];
  const element = () => ({ value: '', checked: false, textContent: '', innerHTML: '', disabled: false, open: false, listeners: {}, classList: { toggle() {}, contains: () => false }, setAttribute() {}, focus() {}, remove() { this.removed = true; }, showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.({}); }, addEventListener(name, callback) { this.listeners[name] = callback; }, querySelectorAll() { return []; }, querySelector() { return element(); } });
  const get = (id) => { if (!fields.has(id)) fields.set(id, element()); return fields.get(id); };
  const context = vm.createContext({
    locale: 'en', console, Date, URL, TextEncoder, setTimeout, clearTimeout,
    $: get, esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    invoke: async (command, args) => { calls.push({ command, args }); return handler(command, args); },
    document: { body: { appendChild() {} }, createElement() { const node = element(); created.push(node); return node; } },
    toast: (...values) => notices.push(values),
  });
  vm.runInContext(source, context);
  return { context, calls, get, created, notices, run: (code) => vm.runInContext(code, context) };
}
const tick = () => new Promise(setImmediate);
test('automatic full memory backups import only reviewed content and reject injected metadata', () => {
  const h = harness();
  h.context.backup = { version: 1, memories: [{ id: 'a', content: 'Keep project names', enabled: true, updatedAt: 4 }, { id: 'b', content: 'Keep project names', enabled: false, updatedAt: 5 }] };
  assert.deepEqual(Array.from(h.run('parseAgentMemoryBackup(JSON.stringify(backup))')), ['Keep project names']);
  h.context.backup.memories[0].root = 'C:\\other';
  assert.throws(() => h.run('parseAgentMemoryBackup(JSON.stringify(backup))'));
  delete h.context.backup.memories[0].root;
  h.context.backup.memories[1].id = 'a';
  assert.throws(() => h.run('parseAgentMemoryBackup(JSON.stringify(backup))'));
});
const builtinSkill = (slug = 'file-organize', extra = {}) => ({
  id: `builtin.${slug}`, name: slug === 'file-organize' ? '文件整理' : '调试与测试建议', description: '根据提供材料分析',
  source: 'builtin', version: '1.0.0', availability: slug === 'file-organize' ? 'file-actions' : 'advice',
  path: `builtin://${slug}/SKILL.md`, body: 'Instructions <script>alert(1)</script>', enabled: false, ...extra,
});
function changeSkill(h, id, checked) {
  const input = { dataset: { agentSkill: id }, checked, matches: (selector) => selector === '[data-agent-skill]' };
  h.created[0].listeners.change({ target: input });
  return input;
}
function clickProfileAction(h, action, id) {
  const button = { dataset: { agentAction: action, id } };
  h.created[0].listeners.click({ target: { closest: (selector) => selector === '[data-agent-action]' ? button : null } });
}

test('skills clearly group bundled and legacy imported instructions without treating a builtin URI as a file', async () => {
  const h = harness(async () => profile({ skills: [builtinSkill(), builtinSkill('debug-and-test'), { id: 'legacy', name: 'My old rules', description: 'Keep project names', path: 'C:\\skills\\SKILL.md', body: 'User instructions', enabled: false }] }));
  await h.run("openAgentProfile('skills')");
  const markup = h.get('agentProfileBody').innerHTML;
  assert.match(markup, /data-agent-skill-group="builtin"/);
  assert.match(markup, /data-agent-skill-group="user"/);
  assert.match(markup, /data-agent-skill-id="legacy" data-agent-skill-source="user"/);
  assert.match(markup, /agent-skill-version">v1\.0\.0/);
  assert.match(markup, /data-agent-skill-availability="file-actions"[^>]*>File organization supported/);
  assert.match(markup, /data-agent-skill-availability="advice"[^>]*>Analysis and advice \(execution tools not connected\)/);
  assert.match(markup, /data-agent-action="remove-skill" data-id="legacy"/);
  const userGroup = markup.split('data-agent-skill-group="user"')[1];
  assert.doesNotMatch(userGroup, /data-agent-skill-availability|execution tools not connected/);
  assert.match(userGroup, /Uses the current chat tools and permissions/);
  assert.match(markup, /C:\\skills\\SKILL.md/);
  assert.doesNotMatch(markup, /builtin:\/\/|data-agent-action="remove-skill" data-id="builtin\./);
  assert.match(markup, /id="agentSkillEnabledCount">0 \/ 4 enabled for chat/);
  assert.doesNotMatch(markup, /data-agent-skill="builtin\.[^"]+"[^>]* checked/);
  assert.ok(h.calls.every((call) => call.command === 'agent_profile'), 'opening does not activate or persist built-in skills');
});

test('built-in instructions are escaped for reading and reject removal even from a stale action', async () => {
  const h = harness(async () => profile({ skills: [builtinSkill()] }));
  await h.run("openAgentProfile('skills')");
  clickProfileAction(h, 'view-skill', 'builtin.file-organize');
  assert.match(h.get('agentProfileBody').innerHTML, /class="agent-skill-source">Instructions &lt;script>/);
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML, /<script>|<textarea/);
  clickProfileAction(h, 'remove-skill', 'builtin.file-organize'); await tick();
  assert.match(h.get('agentProfileStatus').textContent, /cannot be removed/);
  assert.equal(h.calls.some((call) => call.command === 'agent_skill_remove'), false);
  clickProfileAction(h, 'view-skill', 'builtin.file-organize');
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML, /class="agent-skill-source"/);
});

test('built-in names and summaries follow the UI language without translating user content or request IDs', async () => {
  const h = harness(async () => profile({ skills: [builtinSkill('file-organize', { enabled: true }), { id: 'my-rule', name: '我的原始标题', description: '我的说明', enabled: true }] }));
  await h.run("openAgentProfile('skills')");
  assert.match(h.get('agentProfileBody').innerHTML, /File organization<\/strong>/);
  assert.match(h.get('agentProfileBody').innerHTML, /Review folder and selection metadata/);
  assert.match(h.get('agentProfileBody').innerHTML, /我的原始标题/);
  assert.match(h.get('aiAgentContext').innerHTML, /File organization/);
  h.context.locale = 'zh'; h.run('renderAgentManager(); renderAgentContext()');
  assert.match(h.get('agentProfileBody').innerHTML, /文件整理<\/strong>/);
  assert.match(h.get('agentProfileBody').innerHTML, /内置技能|支持文件整理/);
  assert.match(h.get('aiAgentContext').innerHTML, /文件整理/);
  assert.deepEqual([...(await h.run('getAgentRequestContext(null)')).skillIds], ['builtin.file-organize', 'my-rule']);
});

test('the four-skill limit counts both sources and turning one off never replaces another enabled skill', async () => {
  const skills = [builtinSkill('file-organize', { enabled: true }), builtinSkill('task-planning', { enabled: true }), builtinSkill('debug-and-test'), { id: 'one', enabled: true }, { id: 'two', enabled: true }];
  const h = harness(async (command, args) => {
    if (command === 'agent_skill_set') { skills.find((skill) => skill.id === args.id).enabled = args.enabled; return; }
    return profile({ skills: skills.map((skill) => ({ ...skill })) });
  });
  await h.run("openAgentProfile('skills')");
  const rejected = changeSkill(h, 'builtin.debug-and-test', true); await tick();
  assert.equal(rejected.checked, false);
  assert.match(h.get('agentProfileStatus').textContent, /4 skills/);
  assert.equal(h.calls.some((call) => call.command === 'agent_skill_set'), false);
  changeSkill(h, 'one', false); await tick();
  changeSkill(h, 'builtin.debug-and-test', true); await tick();
  assert.deepEqual(h.calls.filter((call) => call.command === 'agent_skill_set').map((call) => [call.args.id, call.args.enabled]), [['one', false], ['builtin.debug-and-test', true]]);
  const request = await h.run('getAgentRequestContext(null)');
  assert.deepEqual([...request.skillIds], ['builtin.file-organize', 'builtin.task-planning', 'builtin.debug-and-test', 'two']);
  assert.match(h.get('agentProfileBody').innerHTML, /id="agentSkillEnabledCount">4 \/ 4/);
});

test('a failed built-in toggle shows the native error and restores the saved enable state', async () => {
  const h = harness(async (command) => {
    if (command === 'agent_skill_set') throw new Error('profile write denied');
    return profile({ skills: [builtinSkill('debug-and-test')] });
  });
  await h.run("openAgentProfile('skills')");
  changeSkill(h, 'builtin.debug-and-test', true); await tick();
  assert.match(h.get('agentProfileStatus').textContent, /profile write denied/);
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML, /data-agent-skill="builtin.debug-and-test"[^>]* checked/);
  assert.equal(h.run('agentProfileBusy'), false);
  assert.deepEqual([...(await h.run('getAgentRequestContext(null)')).skillIds], []);
});

test('advisory skills remain selectable without a working folder or execution permission and only send their IDs', async () => {
  let enabled = false;
  const h = harness(async (command, args) => {
    if (command === 'agent_skill_set') { enabled = args.enabled; return; }
    return profile({ skills: [builtinSkill('debug-and-test', { enabled })], memoryEnabled: false });
  });
  await h.run("openAgentProfile('skills')");
  const markup = h.get('agentProfileBody').innerHTML;
  assert.match(markup, /Advisory skills also work in read-only mode/);
  const control = markup.match(/<input[^>]+data-agent-skill="builtin.debug-and-test"[^>]*>/)[0];
  assert.doesNotMatch(control, /disabled|data-agent-requires-root/);
  changeSkill(h, 'builtin.debug-and-test', true); await tick();
  const request = await h.run('getAgentRequestContext(null)');
  assert.deepEqual([...request.skillIds], ['builtin.debug-and-test']);
  assert.equal(JSON.stringify(request).includes('Instructions'), false);
  assert.ok(h.calls.every((call) => ['agent_profile', 'agent_skill_set'].includes(call.command)));
});

test('user import and removal preserve the combined built-in catalog and enabled selections', async () => {
  const skills = [builtinSkill('file-organize', { enabled: true })];
  const h = harness(async (command, args) => {
    if (command === 'agent_skill_import') { skills.push({ id: 'imported', name: 'My rules', description: 'Keep names', path: args.path, body: 'Original instructions', source: 'user', version: '', availability: 'advice', enabled: false }); return skills.at(-1); }
    if (command === 'agent_skill_remove') { skills.splice(skills.findIndex((skill) => skill.id === args.id), 1); return; }
    return profile({ skills: skills.map((skill) => ({ ...skill })) });
  });
  await h.run("openAgentProfile('skills')");
  h.get('agentSkillPath').value = ' C:\\my-skills\\SKILL.md ';
  await h.run('importAgentSkill()');
  assert.match(h.get('agentProfileBody').innerHTML, /data-agent-skill-id="imported" data-agent-skill-source="user"/);
  assert.match(h.get('agentProfileBody').innerHTML, /data-agent-action="remove-skill" data-id="imported"/);
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML.split('data-agent-skill-group="user"')[1], /execution tools not connected/);
  assert.equal(h.calls.find((call) => call.command === 'agent_skill_import').args.path, 'C:\\my-skills\\SKILL.md');
  assert.deepEqual([...(await h.run('getAgentRequestContext(null)')).skillIds], ['builtin.file-organize']);
  assert.equal(await h.run("removeAgentSkill('imported')"), true);
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML, /data-agent-skill-id="imported"/);
  assert.match(h.get('agentProfileBody').innerHTML, /data-agent-skill-id="builtin.file-organize"/);
  assert.deepEqual([...(await h.run('getAgentRequestContext(null)')).skillIds], ['builtin.file-organize']);
});

test('portable memory exports contain only text and import rejects executable or scope fields', () => {
  const h = harness();
  h.context.saved = profile({ apiKey: 'secret', skills: [{ body: 'skill body' }], memories: [{ id: 'local-id', root: 'C:\\private', content: 'Use dates', enabled: true, updatedAt: 12 }] });
  const text = h.run('serializeAgentMemories(saved)');
  assert.deepEqual(JSON.parse(text), { format: 'dalizi-folder-memories', version: 1, memories: [{ content: 'Use dates' }] });
  h.context.backup = text;
  assert.deepEqual([...h.run('parseAgentMemoryBackup(backup)')], ['Use dates']);
  for (const extra of [{ root: 'C:\\other' }, { apiKey: 'secret' }, { skills: [] }]) {
    h.context.backup = JSON.stringify({ ...JSON.parse(text), ...extra });
    assert.throws(() => h.run('parseAgentMemoryBackup(backup)'), /Unsupported/);
  }
  h.context.backup = JSON.stringify({ ...JSON.parse(text), memories: [{ content: 'Use dates', enabled: true }] });
  assert.throws(() => h.run('parseAgentMemoryBackup(backup)'), /Unsupported/);
});

test('memory backups enforce file, item and Unicode limits and remove exact duplicates', () => {
  const h = harness();
  const encode = (memories) => JSON.stringify({ format: 'dalizi-folder-memories', version: 1, memories: memories.map((content) => ({ content })) });
  h.context.backup = encode(['Use dates', ' Use dates ', '😀'.repeat(2000)]);
  assert.equal(h.run('parseAgentMemoryBackup(backup).length'), 2);
  for (const contents of [['😀'.repeat(2001)], Array(101).fill('test'), ['\0'], ['']]) {
    h.context.backup = encode(contents); assert.throws(() => h.run('parseAgentMemoryBackup(backup)'));
  }
  h.context.backup = ' '.repeat(1024 * 1024 + 1);
  assert.throws(() => h.run('parseAgentMemoryBackup(backup)'), /1 MB/);
});

test('memory import preview is inert and requires selection; confirmation retains the reviewed destination', async () => {
  const h = harness(async (command) => command === 'agent_memory_import' ? 1 : profile());
  h.context.saved = profile({ memories: [{ content: 'Already here' }] });
  h.run("openAgentMemoryImport('C:\\\\original', ['Already here', '<script>doStuff()</script>'], saved)");
  assert.equal(h.calls.length, 0);
  assert.match(h.created[0].innerHTML, /&lt;script>/);
  assert.doesNotMatch(h.created[0].innerHTML, /<script>/);
  assert.equal(await h.run('confirmAgentMemoryImport()'), false);
  assert.equal(h.calls.length, 0, 'preview and empty selection do not write');
  h.run("agentMemoryTransfer.selected.add(1); agentManagerRoot = 'D:\\\\other'; agentProfileRoot = 'D:\\\\other'");
  assert.equal(await h.run('confirmAgentMemoryImport()'), true);
  const request = h.calls.find((call) => call.command === 'agent_memory_import').args;
  assert.equal(request.root, 'C:\\original');
  assert.deepEqual([...request.contents], ['<script>doStuff()</script>']);
  assert.equal(h.run('agentMemoryTransfer'), null);
});

test('memory import cancellation and failed writes preserve existing state and review choices', async () => {
  const h = harness(async () => { throw new Error('read only folder'); });
  h.context.saved = profile();
  h.run("openAgentMemoryImport('C:\\\\work', ['My memory'], saved)");
  h.created[0].close();
  assert.equal(h.calls.length, 0);
  h.run("openAgentMemoryImport('C:\\\\work', ['My memory'], saved); agentMemoryTransfer.selected.add(0)");
  assert.equal(await h.run('confirmAgentMemoryImport()'), false);
  assert.match(h.get('agentMemoryImportError').textContent, /read only folder/);
  assert.equal(h.run('agentMemoryTransfer.selected.size'), 1);
  assert.equal(h.run('agentMemoryTransfer.busy'), false);
  assert.equal(h.created[1].open, true);
});

test('profile reads coalesce frequent workspace syncs and keep late folders out of current context', async () => {
  const first = deferred(), second = deferred();
  const h = harness((_command, args) => args.root === 'C:\\one' ? first.promise : second.promise);
  h.run("syncAgentProfile('C:\\\\one'); syncAgentProfile('C:\\\\one'); syncAgentProfile('D:\\\\two');");
  assert.equal(h.calls.length, 2);
  second.resolve(profile({ skills: [{ id: 'two', name: 'Folder Two', description: 'two', enabled: true }] })); await tick();
  assert.match(h.get('aiAgentContext').innerHTML, /Folder Two/);
  first.resolve(profile({ skills: [{ id: 'one', name: 'Folder One', description: 'one', enabled: true }] })); await tick();
  assert.match(h.get('aiAgentContext').innerHTML, /Folder Two/);
  assert.doesNotMatch(h.get('aiAgentContext').innerHTML, /Folder One/);
  h.run("syncAgentProfile('d:\\\\TWO\\\\');"); await tick();
  assert.equal(h.calls.length, 2, 'normalized scopes reuse the same local snapshot');
});

test('request context includes only enabled skills and selected memory modes, without content copies', async () => {
  const h = harness(async () => profile({ skills: [{ id: 'a', enabled: true, body: 'private instructions' }, { id: 'b', enabled: false }], memoryEnabled: false, learningEnabled: true }));
  const result = await h.run("getAgentRequestContext('C:\\\\work')");
  assert.deepEqual([...result.skillIds], ['a']); assert.equal(result.useMemory, false); assert.equal(result.learnMemory, true);
  assert.equal(JSON.stringify(result).includes('private instructions'), false);
  await h.run("getAgentRequestContext('C:\\\\work')"); assert.equal(h.calls.length, 2);
});

test('excess active skills and failed profile reads reject the request instead of silently dropping context', async () => {
  const excess = harness(async () => profile({ skills: Array.from({ length: 5 }, (_, i) => ({ id: String(i), enabled: true })) }));
  await assert.rejects(excess.run("getAgentRequestContext('C:\\\\work')"), /4 skills/);
  const broken = harness(async () => { throw new Error('disk read failed'); });
  await assert.rejects(broken.run("getAgentRequestContext('C:\\\\work')"), /disk read failed/);
  broken.run("syncAgentProfile('C:\\\\work')"); await tick();
  assert.match(broken.get('aiAgentContext').innerHTML, /Configuration unavailable/);
});

test('a broken local memory blocks enabled-memory requests but still allows skills when memories are off', async () => {
  let memoryEnabled = true, memoryError = 'Invalid local memory; original preserved';
  const h = harness(async () => profile({ skills: [{ id: 'organize', enabled: true }], memoryEnabled, memoryError }));
  await assert.rejects(h.run("getAgentRequestContext('C:\\\\work')"), /Invalid local memory.*\n.*turn off Use memories/);
  memoryEnabled = false;
  const result = await h.run("getAgentRequestContext('C:\\\\work')");
  assert.deepEqual([...result.skillIds], ['organize']); assert.equal(result.useMemory, false);
  memoryEnabled = true; memoryError = null;
  assert.equal((await h.run("getAgentRequestContext('C:\\\\work')")).useMemory, true);
});

test('memory read failures remain visible without claiming an empty file or hiding skill and preference controls', async () => {
  const h = harness(async () => profile({
    skills: [{ id: 'organize', enabled: true, name: 'Organizer', description: 'Rules', path: 'C:\\skills\\SKILL.md', body: 'Sort files' }],
    memoryError: 'Invalid local memory <script> at C:\\work\\.dalizi\\agent-memory.json',
    legacyMemories: [{ id: 'old', scope: 'global', content: 'Keep names', enabled: true }],
  }));
  h.run("syncAgentProfile('C:\\\\work')"); await tick();
  assert.match(h.get('aiAgentContext').innerHTML, /Folder memory unavailable/);
  assert.match(h.get('aiAgentContext').innerHTML, /<b>!<\/b>/);
  await h.run("openAgentProfile('memories')");
  const markup = h.get('agentProfileBody').innerHTML;
  assert.match(markup, /id="agentMemoryStoragePath"[^>]*>C:\\work\\.dalizi\\agent-memory.json/);
  assert.match(markup, /id="agentUseMemories"/);
  assert.match(markup, /data-agent-action="add-memory"[^>]*disabled/);
  assert.match(markup, /Invalid local memory &lt;script>/);
  assert.doesNotMatch(markup, /No saved memories yet|<script>|Already in this folder|data-agent-action="migrate-memories"/);
  await h.run("openAgentProfile('skills')");
  assert.match(h.get('agentProfileBody').innerHTML, /data-agent-skill="organize"/);
  assert.match(h.get('agentProfileBody').innerHTML, /Folder memory unavailable/);
  assert.ok(h.calls.every((call) => call.command === 'agent_profile'), 'error inspection never writes files');
});

test('skill context labels escape imported names and descriptions', async () => {
  const h = harness(async () => profile({ skills: [{ id: 'a', enabled: true, name: '<img src=x>', description: '" onclick="bad' }] }));
  h.run("syncAgentProfile('C:\\\\work')"); await tick();
  assert.match(h.get('aiAgentContext').innerHTML, /&lt;img/);
  assert.doesNotMatch(h.get('aiAgentContext').innerHTML, /<img/);
  assert.match(h.get('aiAgentContext').innerHTML, /&quot;/);
});

test('memory validation counts Unicode characters and always requires a local folder', () => {
  const h = harness();
  h.context.value = { content: '😀'.repeat(2000), scope: 'folder' };
  assert.equal(h.run("validateAgentMemory(value, 'C:\\\\work')"), '');
  h.context.value.content += 'x'; assert.match(h.run("validateAgentMemory(value, 'C:\\\\work')"), /2000/);
  h.context.value.content = 'Remember this'; assert.match(h.run('validateAgentMemory(value, null)'), /Open a local folder/);
  h.context.value.scope = 'global'; assert.match(h.run('validateAgentMemory(value, null)'), /Open a local folder/);
});

test('skill import needs an explicit path and refreshes local context after success', async () => {
  const h = harness(async (command) => command === 'agent_profile' ? profile() : { id: 'imported', enabled: false });
  await h.run('importAgentSkill()');
  assert.equal(h.calls.length, 0); assert.match(h.get('agentProfileStatus').textContent, /Choose a skill/);
  h.get('agentSkillPath').value = '  C:\\skills\\organize\\SKILL.md  ';
  await h.run('importAgentSkill()');
  const imported = h.calls.find((call) => call.command === 'agent_skill_import');
  assert.equal(imported.args.path, 'C:\\skills\\organize\\SKILL.md');
  assert.equal(h.get('agentSkillPath').value, '');
  assert.ok(h.calls.some((call) => call.command === 'agent_profile'));
  assert.equal(h.calls.some((call) => call.command === 'ai_plan'), false);
});

test('a suggested memory does not persist until save and retains its originating folder after navigation', async () => {
  const h = harness(async (command) => command === 'agent_profile' ? profile() : undefined);
  const saved = h.run("saveAgentSuggestedMemory('C:\\\\original', 'Use dated folders')");
  assert.equal(h.calls.length, 0, 'opening a suggestion is not approval to save');
  h.run("agentProfileRoot = 'D:\\\\other'; agentManagerRoot = 'D:\\\\other';");
  await h.get('agentMemoryForm').listeners.submit({ preventDefault() {} });
  assert.equal(await saved, true);
  const request = h.calls.find((call) => call.command === 'agent_memory_save').args.memory;
  assert.equal(request.root, 'C:\\original'); assert.equal(request.scope, 'folder'); assert.equal(request.content, 'Use dated folders');
  assert.equal(request.id, null);
});

test('cancelling a memory suggestion resolves false and makes no persistence calls', async () => {
  const h = harness();
  const result = h.run("saveAgentSuggestedMemory('C:\\\\work', 'A draft')");
  h.created[0].close();
  assert.equal(await result, false); assert.equal(h.calls.length, 0);
  assert.equal(h.run('agentMemoryEditor'), null);
});

test('failed memory saves keep the editable draft, allowing correction or cancel', async () => {
  const h = harness(async (command) => { if (command === 'agent_memory_save') throw new Error('storage full'); return profile(); });
  const result = h.run("saveAgentSuggestedMemory('C:\\\\work', 'A draft')");
  await h.get('agentMemoryForm').listeners.submit({ preventDefault() {} });
  assert.equal(h.created[0].open, true); assert.match(h.get('agentMemoryError').textContent, /storage full/);
  assert.equal(h.get('agentMemoryContent').value, 'A draft');
  assert.equal(h.run('agentMemoryEditor.busy'), false);
  h.created[0].close(); assert.equal(await result, false);
});

test('each request reloads profile changes made outside the cached workspace snapshot', async () => {
  let externalEnabled = false;
  const h = harness(async () => profile({ memoryEnabled: externalEnabled }));
  h.run("syncAgentProfile('C:\\\\work')"); await tick();
  assert.equal(h.calls.length, 1);
  externalEnabled = true;
  const next = await h.run("getAgentRequestContext('C:\\\\work')");
  assert.equal(next.useMemory, true); assert.equal(h.calls.length, 2);
  h.run("syncAgentProfile('C:\\\\work'); syncAgentProfile('C:\\\\work')"); await tick();
  assert.equal(h.calls.length, 2, 'ordinary renders still share the new snapshot');
});

test('opening management refreshes disk state without creating memory files', async () => {
  const h = harness();
  h.run("syncAgentProfile('C:\\\\work')"); await tick();
  await h.run("openAgentProfile('memories')");
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((call) => call.command === 'agent_profile'));
  assert.match(h.get('agentProfileBody').innerHTML, /C:\\work\\.dalizi\\agent-memory.json/);
  assert.doesNotMatch(h.get('agentProfileBody').innerHTML, /C:\\profiles\\agent.json/);
});

test('memory editor has a fixed local path, and no-folder suggestions cannot save', async () => {
  const h = harness();
  const result = h.run("saveAgentSuggestedMemory(null, 'A draft')");
  assert.equal(h.get('agentMemorySave').disabled, true);
  assert.doesNotMatch(h.created[0].innerHTML, /<select|agentMemoryScope/);
  await h.get('agentMemoryForm').listeners.submit({ preventDefault() {} });
  assert.equal(h.calls.length, 0);
  assert.match(h.get('agentMemoryError').textContent, /local folder/);
  h.created[0].close(); assert.equal(await result, false);
});

test('deleting a memory sends its captured folder along with the identifier', async () => {
  const saved = deferred();
  const h = harness(async (command) => command === 'agent_memory_delete' ? saved.promise : profile());
  h.run("agentManagerRoot = 'C:\\\\work'");
  const request = h.run("deleteAgentMemory('same-id')");
  h.run("agentManagerRoot = 'D:\\\\other'");
  saved.resolve(); await request;
  const call = h.calls.find((item) => item.command === 'agent_memory_delete');
  assert.equal(call.args.root, 'C:\\work'); assert.equal(call.args.id, 'same-id');
});

test('legacy memories require explicit selection and copy only available selected entries to the current folder', async () => {
  const old = [{ id: 'global-old', scope: 'global', root: null, content: 'Already local', enabled: true }, { id: 'folder-old', scope: 'folder', root: 'C:\\work', content: 'Copy this rule', enabled: true }];
  let migrated = false;
  const h = harness(async (command) => {
    if (command === 'agent_memory_migrate') { migrated = true; return; }
    return profile({ legacyMemories: old, memories: [{ id: 'local', content: 'Already local', enabled: true }, ...(migrated ? [{ id: 'copied', content: 'Copy this rule', enabled: true }] : [])] });
  });
  h.run("agentManagerRoot = 'C:\\\\work'");
  await h.run("loadAgentProfile('C:\\\\work')");
  assert.equal(h.calls.some((call) => call.command === 'agent_memory_migrate'), false);
  assert.equal(await h.run('migrateAgentMemories()'), false);
  h.run("agentLegacySelection = new Set(['global-old', 'folder-old', 'unknown'])");
  assert.equal(await h.run('migrateAgentMemories()'), true);
  const call = h.calls.find((item) => item.command === 'agent_memory_migrate');
  assert.deepEqual([...call.args.ids], ['folder-old']); assert.equal(call.args.root, 'C:\\work');
  assert.equal(h.calls.some((item) => item.command === 'agent_memory_delete'), false, 'migration preserves the legacy source');
  assert.equal(h.run('agentLegacySelection.size'), 0);
});
