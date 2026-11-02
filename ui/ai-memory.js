'use strict';
/* Conversation summaries are context, separate from approved long-term memories. */
const memoryText = (zh, en) => locale === 'zh' ? zh : en;
function aiMemoryPreferences() {
  const raw = store.get('aiMemoryPreferences', {});
  return { autoCompact: raw?.autoCompact !== false, autoDeduplicate: raw?.autoDeduplicate !== false };
}
function saveAiMemoryPreference(key, value) {
  if (!['autoCompact', 'autoDeduplicate'].includes(key)) return;
  const next = { ...aiMemoryPreferences(), [key]: !!value };
  store.set('aiMemoryPreferences', next);
  if (JSON.stringify(store.get('aiMemoryPreferences', null)) !== JSON.stringify(next)) throw new Error(memoryText('无法保存记忆偏好', 'Could not save memory preferences'));
  renderAiContextMeter();
}
function estimateAiTokens(text) {
  const chars = [...String(text)], ascii = chars.filter((c) => c.codePointAt(0) <= 127).length;
  return Math.ceil(ascii / 4) + chars.length - ascii;
}
function aiMemoryMessage(message) {
  if (message.omitHistory || !message.text) return null;
  let facts = '';
  if (message.plan) facts += '[Plan status: ' + message.planState + '; a proposed plan is not proof of execution.]\n' + aiChars(JSON.stringify(message.plan.actions), 1500) + '\n';
  if (message.results) facts += '[Local execution results]\n' + aiChars(JSON.stringify(message.results), 1500) + '\n';
  const content = facts + aiChars(message.text, Math.max(0, 8000 - [...facts].length));
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: aiChars(content, 8000) };
}
function aiUncompressedMessages(session, messages = session.messages) {
  return messages.filter((message) => !session.summarizedIds?.has(message.id) && aiMemoryMessage(message));
}
function aiMemoryHistory(session) {
  const output = [];
  let remaining = 24000 - [...(session.conversationSummary || '')].length;
  for (const message of aiUncompressedMessages(session).reverse()) {
    const item = aiMemoryMessage(message);
    item.content = aiChars(item.content, Math.max(0, remaining));
    if (!item.content) break;
    output.unshift(item); remaining -= [...item.content].length;
    if (output.length >= 16 || !remaining) break;
  }
  return output;
}
function aiCompactionCandidates(session, messages = session.messages, force = false) {
  const available = aiUncompressedMessages(session, messages);
  const total = available.reduce((sum, message) => sum + [...aiMemoryMessage(message).content].length, [...(session.conversationSummary || '')].length);
  if (!force && available.length <= 12 && total < 18000) return [];
  // Keep at least the last two messages verbatim, and up to six when they fit.
  let keep = 0, recentChars = 0;
  for (const message of [...available].reverse()) {
    const count = [...aiMemoryMessage(message).content].length;
    if (keep >= 2 && (keep >= 6 || recentChars + count > 12000)) break;
    recentChars += count; keep++;
  }
  return available.slice(0, Math.max(0, available.length - keep));
}
async function prepareAiMemory(session, requestId, messages = session.messages, force = false) {
  if (!force && !aiMemoryPreferences().autoCompact) return;
  let candidates = aiCompactionCandidates(session, messages, force);
  const current = () => session.requestId === requestId && aiSessions.get(session.key) === session && !session.closed;
  if (!candidates.length || !current()) return;
  session.compacting = true; session.memoryWarning = ''; renderAiContextMeter();
  try {
    while (candidates.length && current()) {
      const batch = []; let characters = 0;
      for (const message of candidates) {
        const count = [...aiMemoryMessage(message).content].length;
        if (batch.length >= 16 || characters + count > 24000) break;
        batch.push(message); characters += count;
      }
      if (!batch.length) break;
      const result = await invoke('ai_compact', { request: { requestId, ...aiSettings, apiKey: aiSessionKey, summary: session.conversationSummary || '', history: batch.map(aiMemoryMessage) } });
      if (!current()) return;
      if (!result || typeof result.summary !== 'string' || !result.summary.trim() || [...result.summary].length > 6000 || [...result.summary].length >= characters + [...(session.conversationSummary || '')].length) throw new Error(memoryText('摘要无效，原对话已保留', 'Invalid summary; original conversation retained'));
      session.conversationSummary = result.summary;
      session.summarizedIds ||= new Set(); batch.forEach((message) => session.summarizedIds.add(message.id));
      session.compactionCount = (session.compactionCount || 0) + 1;
      session.compactedMessages = (session.compactedMessages || 0) + batch.length;
      session.lastCompaction = { before: result.beforeCharacters, after: result.afterCharacters };
      session.revision++;
      candidates = candidates.slice(batch.length);
    }
  } finally { session.compacting = false; if (typeof scheduleAiArchive === 'function') scheduleAiArchive(session); if (aiCurrentSession() === session) renderAiContextMeter(); }
}
async function compactAiConversation() {
  const session = aiCurrentSession();
  if (!session || session.requestId || session.running) return;
  if (!aiSettings.endpoint || !aiSettings.model) { toggleAiSettings(true); return; }
  if (!aiCompactionCandidates(session, session.messages, true).length) { toast(memoryText('较早对话不足，近期消息会保留原文', 'Not enough older messages; recent messages stay verbatim')); return; }
  const requestId = crypto.randomUUID(); session.requestId = requestId; updateAiComposer();
  try { await prepareAiMemory(session, requestId, session.messages.slice(), true); }
  catch (error) { if (session.requestId === requestId) { session.memoryWarning = String(error); toast(String(error), true); } }
  finally { if (session.requestId === requestId) session.requestId = null; if (aiCurrentSession() === session) { renderAiConversation(); updateAiComposer(); } }
}
function renderAiContextMeter() {
  const meter = $('aiContextMeter'); if (!meter) return;
  const session = aiCurrentSession();
  if (!session) { meter.innerHTML = ''; return; }
  const history = aiMemoryHistory(session), summary = session.conversationSummary || '';
  const characters = [...summary].length + history.reduce((n, item) => n + [...item.content].length, 0);
  const tokens = estimateAiTokens(summary) + history.reduce((n, item) => n + estimateAiTokens(item.content), 0);
  const canCompact = aiCompactionCandidates(session, session.messages, true).length > 0;
  meter.innerHTML = `<div class="ai-context-heading"><strong>${memoryText('聊天上下文', 'Chat context')} · ≈${tokens.toLocaleString()} tokens</strong><button type="button" data-ai-action="compact" ${session.requestId || session.running || !canCompact ? 'disabled' : ''}>${memoryText(session.compacting ? '正在压缩…' : '立即压缩', session.compacting ? 'Compacting…' : 'Compact now')}</button></div><meter min="0" max="24000" value="${characters}" aria-label="${memoryText('聊天字符预算', 'Chat character budget')}"></meter><small>${characters.toLocaleString()} / 24,000 ${memoryText('字符', 'characters')} · ${history.length}/16 ${memoryText('条近期消息', 'recent messages')} · ${aiMemoryPreferences().autoCompact ? memoryText('自动压缩已开启', 'Auto compaction on') : memoryText('自动压缩已关闭', 'Auto compaction off')}</small>${session.memoryWarning ? `<p class="ai-memory-warning" role="status">${esc(session.memoryWarning)}</p>` : ''}${summary ? `<details><summary>${memoryText('查看摘要', 'View summary')} · ${session.compactedMessages || 0} ${memoryText('条较早消息', 'older messages')}</summary><p>${esc(summary)}</p><small>${memoryText('摘要仅用于当前会话，不会保存为目录长期记忆。', 'Summary is for this chat only, not saved as durable folder memory.')}</small></details>` : ''}`;
  meter.title = memoryText('这是聊天部分的估算，不是模型实际用量；不含系统提示、目录元数据、技能与长期记忆。自动摘要使用当前接口，可能产生额外 Token 费用。', 'Estimate for chat only, not provider usage. Excludes system instructions, directory metadata, skills and durable memories. Automatic summaries use the current model and may incur extra token costs.');
}
function renderMemoryMaintenance(profile) {
  const stats = profile.memoryStatistics || { total: profile.memories.length, enabled: profile.memories.filter((x) => x.enabled).length, contentBytes: new TextEncoder().encode(profile.memories.map((x) => x.content).join('')).length, estimatedTokens: profile.memories.reduce((n, x) => n + estimateAiTokens(x.content), 0), duplicates: 0 };
  const prefs = aiMemoryPreferences(), T = memoryText;
  return `<section class="memory-maintenance"><h3>${T('统计与自动整理', 'Statistics & maintenance')}</h3><div class="memory-statistics"><span><strong>${stats.total}</strong>${T('条记忆', 'memories')}</span><span><strong>${stats.enabled}</strong>${T('条启用', 'enabled')}</span><span><strong>${fmtSize(stats.contentBytes)}</strong>${T('正文大小', 'content size')}</span><span><strong>≈${stats.estimatedTokens}</strong>tokens</span></div><p>${T('发现', 'Found')} ${stats.duplicates} ${T('条重复项。整理前生成完整备份，仅合并内容与启用状态相同的条目；不自动改写偏好。', 'duplicates. Creates a full backup before merging identical content with the same enabled state; preferences are never rewritten automatically.')}</p><button type="button" data-agent-action="maintain-memory" data-agent-requires-root="true" ${profile.memoryError || !stats.duplicates ? 'disabled data-agent-fixed-disabled="true"' : ''}>${T('立即整理重复记忆', 'Deduplicate now')}</button><label class="agent-preference compact"><input type="checkbox" data-memory-pref="autoDeduplicate" ${prefs.autoDeduplicate ? 'checked' : ''}><span><strong>${T('对话前自动整理长期记忆', 'Deduplicate durable memory before chatting')}</strong><small>${T('仅处理当前目录已启用记忆功能时的重复项。', 'Only for the current folder when memory use is enabled.')}</small></span></label><label class="agent-preference compact"><input type="checkbox" data-memory-pref="autoCompact" ${prefs.autoCompact ? 'checked' : ''}><span><strong>${T('自动压缩较早聊天', 'Automatically compact older chat')}</strong><small>${T('超过 12 条或接近 18,000 字符时生成摘要，保留近期原文。使用当前模型接口，可能产生额外 Token 费用；失败时保留原对话并提示。Token 数为估算。', 'Summarize above 12 messages or near 18,000 characters, keeping recent text verbatim. Uses the current model and may incur extra token costs. Failures retain the chat and show a notice. Token counts are estimates.')}</small></span></label></section>`;
}
async function maintainAgentMemory() {
  if (agentProfileBusy || !agentManagerRoot) return;
  setAgentProfileBusy(true);
  try {
    const result = await invoke('agent_memory_maintain', { root: agentManagerRoot });
    await refreshAgentProfiles();
    setAgentProfileStatus(memoryText(`已合并 ${result.removed} 条重复记忆`, `Merged ${result.removed} duplicate memories`) + (result.backupPath ? ' · ' + result.backupPath : ''));
  } catch (error) { setAgentProfileStatus(String(error), true); }
  finally { setAgentProfileBusy(false); }
}
