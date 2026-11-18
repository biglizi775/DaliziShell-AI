const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ui/ai-conversations.js'), 'utf8');
const desktopExit = fs.readFileSync(require('node:path').join(__dirname, '../ui/desktop-exit.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(handler) {
  let id = 0; const calls = [], timers = new Map(), notices = [];
  const session = { root: 'C:\\work', messages: [{ id: 'm1', role: 'user', text: '整理文件' }], revision: 1 };
  const context = vm.createContext({ locale: 'zh', crypto: { randomUUID: () => 'id-' + (++id) }, aiChars: (text, n) => [...text].slice(0, n).join(''),
    session, $: () => null, aiCurrentSession: () => session, toast: (...args) => notices.push(args),
    setTimeout: (fn) => { const key = ++id; timers.set(key, fn); return key; }, clearTimeout: (key) => timers.delete(key),
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return handler ? handler(cmd, args, calls.length) : { revision: args.expectedRevision + 1 }; },
  });
  vm.runInContext(source, context);
  context.chooseAiArchiveRecovery = async () => 'keep';
  return { context, session, calls, timers, notices, run: (code) => vm.runInContext(code, context) };
}
function desktopHarness(handler) {
  const h = harness(handler);
  const progress = {open:false, close() { this.open=false; }, remove() {}};
  const main = {closed:0, async destroy() { this.closed++; }};
  Object.assign(h.context, {window:{}, aiSessions:new Map([['one',h.session]]), main,
    persistWorkspaceSession() {}, closeEvent:{preventDefault() {}}});
  Object.assign(h.context, { localPlanning: 0, localQueueRunning: false });
  vm.runInContext(desktopExit,h.context);
  h.context.showDesktopExitProgress = () => { progress.open=true; return progress; };
  return {...h, progress, main, close:() => h.run('handleDesktopClose(closeEvent,main)')};
}
test('cancelling exit during a manual write leaves a later failure for the next exit decision', async () => {
  const first=deferred(), h=desktopHarness(()=>first.promise);
  const writing=h.run('saveAiArchive(session)');
  let decisions=0;
  h.context.chooseAiArchiveRecovery=async()=>{ decisions++; return 'discard'; };
  const leaving=h.close();
  h.progress.close(); first.reject('folder locked');
  await writing; await leaving;
  assert.equal(decisions,0); assert.equal(h.main.closed,0);
  assert.equal(h.run('aiArchiveNeedsFlush(session)'),true);
  await h.close(); assert.equal(decisions,1); assert.equal(h.main.closed,1);
});
test('desktop exit drains a pending manual save through the latest reply without persisting temporary chats', async () => {
  const first=deferred(), h=desktopHarness((_,args,n)=>n===1 ? first.promise : {revision:args.expectedRevision+1});
  h.run("aiSessions.set('temporary',{root:'D:/other',messages:[{id:'x',role:'user',text:'private'}]})");
  const saving=h.run('saveAiArchive(session)'), leaving=h.close();
  await h.close(); assert.equal(h.main.closed,0);
  h.session.messages.push({id:'m2',role:'assistant',text:'after the manual write began'});
  first.resolve({revision:1});await saving;await leaving;
  assert.equal(h.main.closed,1);assert.deepEqual(h.calls.map(call=>call.args.root),[h.session.root,h.session.root]);
  assert.equal(h.calls.at(-1).args.snapshot.messages.at(-1).text,'after the manual write began');
});
test('a running file operation keeps the desktop open before any other conversation is stopped', async () => {
  const h=desktopHarness();
  h.session.requestId='still live';
  h.run("aiSessions.set('file',{root:'D:/work',running:true,messages:[]})");
  await h.close(); assert.equal(h.main.closed,0); assert.equal(h.session.requestId,'still live');
  assert.ok(h.notices.some(([message])=>message.includes('D:/work')));
});
test('archives serialize an allowlist, keep summaries and convert plan/results into historical text', () => {
  const h = harness();
  Object.assign(h.session, { apiKey: 'never-store', permissionMode: 'auto', conversationSummary: '摘要', summarizedIds: new Set(['m1', 'removed']), compactedMessages: 5 });
  Object.assign(h.session.messages[0], { plan: { id: 'live-handle', actions: [{ kind: 'mkdir', target: 'new' }] }, planState: 'pending', results: [{ status: 'done' }], memorySuggestions: [{ content: 'review me' }] });
  const snapshot = JSON.parse(h.run('JSON.stringify(aiArchiveSnapshot(session))'));
  assert.deepEqual(snapshot.summarizedIds, ['m1']); assert.equal(snapshot.summary, '摘要');
  assert.match(snapshot.messages[0].text, /Historical plan.*pending/); assert.match(snapshot.messages[0].text, /Local execution results/);
  assert.doesNotMatch(JSON.stringify(snapshot), /never-store|live-handle|permissionMode|memorySuggestions/);
  assert.deepEqual(Object.keys(snapshot.messages[0]).sort(), ['id', 'omitHistory', 'role', 'text']);
});
test('temporary conversations never schedule disk writes, and auto-save binds the original root', async () => {
  const h = harness(); h.run('scheduleAiArchive(session)'); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
  h.run('aiArchive(session).auto = true; scheduleAiArchive(session); scheduleAiArchive(session)'); assert.equal(h.timers.size, 1);
  await [...h.timers.values()][0](); await Promise.resolve();
  assert.equal(h.calls[0].args.root, 'C:\\work'); assert.equal(h.calls[0].args.expectedRevision, 0);
});
test('overlapping saves serialize versions and include replies arriving during an earlier write', async () => {
  const first = deferred(); const h = harness((_, args, n) => n === 1 ? first.promise : { revision: args.expectedRevision + 1 });
  const a = h.run('saveAiArchive(session)'); h.session.messages.push({ id: 'm2', role: 'assistant', text: '新回复' });
  const b = h.run('saveAiArchive(session)'); assert.equal(h.calls.length, 1);
  first.resolve({ revision: 1 }); assert.equal(await a, true); assert.equal(await b, true);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args.expectedRevision, 1); assert.equal(h.calls[1].args.snapshot.messages.length, 2);
  await h.run('saveAiArchive(session)'); assert.equal(h.calls.length, 2, 'identical content does not rewrite the archive');
});
test('failed saves pause auto-save, preserve revision and can recover using a fresh ID', async () => {
  const h = harness((_, args, n) => n === 1 ? Promise.reject('conflict') : { revision: args.expectedRevision + 1 });
  h.run('aiArchive(session).auto = true'); const original = h.run('session.archive.id');
  assert.equal(await h.run('saveAiArchive(session)'), false); assert.equal(h.run('session.archive.auto'), false); assert.equal(h.run('session.archive.revision'), 0);
  assert.equal(await h.run('saveAiArchive(session, true)'), true); assert.notEqual(h.run('session.archive.id'), original); assert.equal(h.calls[1].args.expectedRevision, 0);
});
test('closing an auto-saved session flushes its own text even when another session is current', async () => {
  const h = harness(); h.run('aiArchive(session).auto = true; scheduleAiArchive(session); retireAiArchive(session)');
  await h.run('session.archive.saving'); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.root, h.session.root);
});
test('a failed pre-close flush preserves the live text and reports that closing must stop', async () => {
  const h = harness(() => Promise.reject('read-only folder'));
  h.session.tab = {}; h.context.aiSessions = new Map([['current', h.session]]);
  h.run('aiArchive(session).auto = true'); assert.equal(h.run('aiTabArchiveNeedsFlush(session.tab)'), true);
  assert.equal(await h.run('flushAiTabArchives(session.tab)'), false);
  assert.equal(h.session.messages[0].text, '整理文件'); assert.match(h.session.archive.error, /read-only/);
  assert.equal(h.session.archive.auto, false);
  assert.equal(h.run('aiTabArchiveNeedsFlush(session.tab)'), true, 'closing a second time must still protect the transcript');
  assert.equal(await h.run('flushAiTabArchives(session.tab)'), false);
});
test('a tab stays protected while a manual save is pending, including a later reply', async () => {
  const first = deferred(); const h = harness((_, args, n) => n === 1 ? first.promise : {revision:args.expectedRevision+1});
  h.session.tab = {}; h.context.aiSessions = new Map([['current', h.session]]);
  const save = h.run('saveAiArchive(session)');
  assert.equal(h.run('aiTabArchiveNeedsFlush(session.tab)'), true);
  const close = h.run('flushAiTabArchives(session.tab)');
  h.session.messages.push({id:'m2',role:'assistant',text:'later'});
  first.resolve({revision:1});
  assert.equal(await save,true); assert.equal(await close,true);
  assert.equal(h.calls.length,2); assert.equal(h.calls[1].args.snapshot.messages.at(-1).text,'later');
});
test('a failed save as new keeps the original ID, saved snapshot and revision for retry', async () => {
  const h = harness((_, args, n) => n === 2 ? Promise.reject('disk busy') : {revision:args.expectedRevision+1});
  await h.run('saveAiArchive(session)');
  const {id,revision,saved}=h.session.archive;
  h.session.messages[0].text='edited';
  assert.equal(await h.run('saveAiArchive(session,true)'),false);
  assert.deepEqual([h.session.archive.id,h.session.archive.revision,h.session.archive.saved],[id,revision,saved]);
  assert.equal(await h.run('saveAiArchive(session)'),true);
  assert.equal(h.calls[2].args.snapshot.id,id);assert.equal(h.calls[2].args.expectedRevision,revision);
});
test('discard is limited to the reviewed transcript; a new reply or concurrent exit cannot inherit it', async () => {
  const h=harness(()=>Promise.reject('conflict')), decision=deferred();
  h.run('aiArchive(session).auto=true'); await h.run('saveAiArchive(session)');
  h.context.chooseAiArchiveRecovery=()=>decision.promise;
  const first=h.run('flushAiArchiveForExit(session)');
  assert.equal(await h.run('flushAiArchiveForExit(session)'),false);
  h.session.messages[0].text='arrived while choosing'; decision.resolve('discard');
  assert.equal(await first,false); assert.equal(h.run('aiArchiveNeedsFlush(session)'),true);
  assert.equal(await h.run('flushAiArchiveForExit(session)'),true);
  assert.equal(h.run('aiArchiveNeedsFlush(session)'),false);
  h.session.messages[0].text='later';assert.equal(h.run('aiArchiveNeedsFlush(session)'),true);
  assert.equal(h.calls.length,1);
});
test('a temporary chat or receipt warning alone never initiates a lifecycle write', async () => {
  const h=harness();h.run("aiArchive(session).error='missing receipt'");
  assert.equal(await h.run('flushAiArchiveForExit(session)'),true);
  assert.equal(h.calls.length,0);
});
test('keep leaves a live reply running; leaving after retry archives the partial reply too', async () => {
  const h=harness((_,args,n)=>n===1?Promise.reject('disk busy'):{revision:args.expectedRevision+1});
  h.session.requestId='active';
  h.context.cancelAiRequest=s=>{s.requestId=null;s.messages.push({id:'m2',role:'assistant',text:'partial reply'});};
  h.run('aiArchive(session).auto=true');await h.run('saveAiArchive(session)');
  assert.equal(await h.run('prepareAiSessionForExit(session)'),false);
  assert.equal(h.session.requestId,'active');
  h.context.chooseAiArchiveRecovery=async()=>'retry';
  assert.equal(await h.run('prepareAiSessionForExit(session)'),true);
  assert.equal(h.session.requestId,null);assert.equal(h.session.archive.auto,false);
  assert.deepEqual(h.calls.map(c=>c.args.expectedRevision),[0,0,1]);
  assert.equal(h.calls[2].args.snapshot.messages.at(-1).text,'partial reply');
});
test('restored chat has no executable plans or elevated permission and does not replace existing conversation', async () => {
  const h = harness(); const restored = { messages: [], root: 'C:\\work', revision: 0, activation: 0, permissionMode: 'auto' };
  Object.assign(h.context, { restored, state: { path: 'C:\\work' }, aiKey: (s) => s.toLowerCase(), curTab: () => restored, newTab: async () => {}, aiCurrentSession: () => restored,
    renderAiConversation() {}, updateAiComposer() {}, openAiAssistant() {}, aiPaintIdentity: '',
    view: { root: 'C:\\work', busy: false, dialog: { close() {}, querySelector: () => ({ textContent: '' }) } },
    record: { snapshot: { id: 'old', title: '已保存', summary: '摘要', summarizedIds: ['m1'], compactedMessages: 3, messages: [{ id: 'm1', role: 'assistant', text: '文字', plan: { id: 'malicious-plan' }, permissionMode: 'auto', omitHistory: false }] } },
  });
  const step = {kind:'read', path:'notes.md', status:'failed', elapsedMs:2, detail:'File not found'};
  h.context.record.snapshot.messages[0].steps = [step];
  await h.run('continueChatArchive(view, record)');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.messages[0].steps)), [step]);
  assert.equal(restored.permissionMode, 'confirm'); assert.equal(restored.archive.auto, false); assert.equal(restored.archive.revision, 0); assert.notEqual(restored.archive.id, 'old');
  assert.equal(restored.messages[0].plan, undefined); assert.equal(h.session.messages[0].text, '整理文件'); assert.equal(h.calls.length, 0);
});
