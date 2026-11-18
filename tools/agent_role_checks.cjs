'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkRoles({page, a, b, addr, requests, responses, until}) {
  await page.evaluate(async ({a, addr}) => {
    setLocale('en'); aiProjectRoot = ''; await navigate(a); openAiAssistant();
    applyAiRuntimeSettings({endpoint: addr, model: 'role-fixture', apiFormat: 'anthropic-messages'}, '');
    aiStreamReplies = false;
  }, {a, addr});
  const select = page.locator('#aiRoleSelect'), toggle = page.locator('#aiRoleSkills');
  const prompt = page.locator('#aiPrompt'), permission = page.locator('#aiPermissionMode');
  await select.waitFor();
  assert.equal(await select.inputValue(), 'general');
  assert.equal(await select.locator('option').count(), 8);
  const manual = await page.evaluate(() => currentAgentProfile(aiCurrentSession().root).skills.filter(s => s.enabled).map(s => s.id));
  const tabA = await page.evaluate(() => state.tab);
  function reply(index, text) {
    responses[index].writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({
      role: 'assistant', stop_reason: 'end_turn', content: [{type: 'text', text}],
    }));
  }
  async function send(text, index) {
    await prompt.fill(text); await prompt.press('Enter'); await until(() => responses.length > index);
  }
  const proposal = label => JSON.stringify({summary: label, actions: [{kind: 'create_text', target: 'role-check.txt', content: label}]});
  const latest = index => JSON.parse(requests[index].messages.at(-1).content);
  await select.selectOption('organizer');
  await page.locator('#aiRoleBar summary').click();
  assert.equal(await toggle.isChecked(), false);
  await page.locator('#aiProjectTools').check();
  await send('First proposal', 0);
  assert.deepEqual(latest(0).selectedSkills.map(s => s.id), manual);
  reply(0, proposal('original pending plan'));
  await page.waitForFunction(() => aiCurrentSession().messages.some(m => m.planState === 'pending'));
  await toggle.check();
  assert.equal(await page.locator('[data-ai-action=execute]').count(), 0);
  await permission.selectOption('auto');
  await send('Second proposal', 1);
  const expected = [...new Set([...manual, 'builtin.file-organize', 'builtin.task-planning'])].slice(0, 4);
  assert.deepEqual(latest(1).selectedSkills.map(s => s.id), expected);
  assert.equal(latest(1).permissionMode, 'auto');
  assert.match(requests[1].system, /Plan folder organization/);
  const originalRequest = await page.evaluate(() => aiCurrentSession().requestId);
  await select.selectOption('design'); await select.selectOption('organizer');
  assert.equal(await page.evaluate(() => aiCurrentSession().requestId), originalRequest);
  reply(1, proposal('late original reply'));
  await page.waitForFunction(() => aiCurrentSession().messages.some(m => m.text === 'late original reply' && m.planState === 'superseded'));
  const late = await page.evaluate(() => {
    const m = aiCurrentSession().messages.find(m => m.text === 'late original reply');
    return {id: m.plan.id, role: m.roleLabel.en, applied: m.appliedSkills.map(s => s.id)};
  });
  assert.equal(late.role, 'File organizer'); assert.deepEqual(late.applied, expected);
  assert.equal(await page.locator('[data-ai-action=execute]').count(), 0);
  await assert.rejects(page.evaluate(id => invoke('ai_execute', {id, approved: true, permissionMode: 'auto'}), late.id));
  await assert.rejects(fs.stat(path.join(a, 'role-check.txt')), {code: 'ENOENT'});
  await select.selectOption('review');
  assert.equal(await permission.inputValue(), 'read-only'); assert.ok(await permission.isDisabled());
  await select.selectOption('terminal');
  assert.ok(await page.locator('#aiProjectTools').isDisabled());
  assert.equal(await page.locator('#aiProjectTools').isChecked(), false);
  await send('Explain the pasted log', 2);
  assert.match(requests[2].system, /Diagnose supplied terminal or SSH logs/);
  const background = JSON.parse(requests[2].messages[0].content);
  assert.deepEqual(Object.keys(background), ['background']);
  assert.deepEqual(Object.keys(background.background).sort(), ['memories', 'skills', 'summary']);
  assert.deepEqual(background.background.skills.map(s => s.id), [...new Set([...manual, 'builtin.terminal-diagnostics', 'builtin.task-planning'])].slice(0, 4));
  reply(2, 'log advice only');
  await page.waitForFunction(() => aiCurrentSession().messages.some(m => m.text === 'log advice only'));
  await page.evaluate(async b => { await newTab(b); }, b);
  await page.waitForFunction(() => !$('aiRoleBar').hidden && $('aiRoleSelect').value === 'general');
  assert.equal(await toggle.isChecked(), false);
  await select.selectOption('development');
  await page.locator('[data-ai-action=new]').click();
  await page.waitForFunction(() => $('aiRoleSelect').value === 'general' && !$('aiRoleSkills').checked);
  await page.evaluate(tab => switchTab(tab), tabA);
  await page.waitForFunction(() => $('aiRoleSelect').value === 'terminal');
  assert.ok(await toggle.isChecked());
  await select.selectOption('organizer');
  assert.equal(await permission.inputValue(), 'read-only');
  assert.equal(await page.locator('#aiProjectTools').isChecked(), false);
  assert.deepEqual(await page.evaluate(() => currentAgentProfile(aiCurrentSession().root).skills.filter(s => s.enabled).map(s => s.id)), manual);
  console.log('Role presets OK: all eight choices, actual model context, opt-in, stale plans discarded across A-B-A, read-only/advice limits, independent folders.');
};
