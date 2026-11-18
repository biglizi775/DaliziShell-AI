'use strict';
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkCopies({page, a, addr, requests, responses, until, close, launch, getPage}) {
  const sourceId = 'builtin.documentation', tag = randomUUID();
  const firstName = 'Docs ' + tag, forkName = 'Draft ' + tag;
  const read = view => view.evaluate(() => invoke('agent_profile', {root:null}));
  const cards = view => view.locator('#agentProfileBody');
  const editor = view => view.locator('#agentSkillEditor');
  async function openSkills(view, folder) {
    await view.evaluate(async root => { setLocale('en'); aiProjectRoot = ''; await navigate(root); openAiAssistant(); }, folder);
    await view.locator('[data-agent-open=skills]').click();
    await cards(view).locator('[data-agent-action=copy-skill]').first().waitFor();
  }
  const original = await read(page);
  assert.equal(path.basename(path.dirname(original.storagePath)), 'com.dalizi.files.harness-m1-test');
  const source = original.skills.find(s => s.id === sourceId);
  const stamp = original.skills.map(s => [s.id, s.name, s.description, s.body, s.enabled]);
  const sourceCard = cards(page).locator(`[data-agent-skill-id="${sourceId}"]`);
  let first, fork;
  try {
    await openSkills(page, a);
    await sourceCard.locator('[data-agent-action=copy-skill]').click();
    assert.equal(await editor(page).locator('[name=body]').inputValue(), source.body);
    await editor(page).locator('[data-copy-cancel]').click();
    assert.equal((await read(page)).skills.length, original.skills.length);
    await sourceCard.locator('[data-agent-action=copy-skill]').click();
    await editor(page).locator('[name=name]').fill(firstName);
    await editor(page).locator('[name=body]').fill('Fixture instruction version one');
    await editor(page).getByRole('button', {name:'Save', exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    first = (await read(page)).skills.find(s => s.name === firstName);
    assert.ok(first && !first.enabled);
    assert.equal(first.copy.sourceId, sourceId); assert.equal(first.copy.version, source.version);
    const firstCard = cards(page).locator(`[data-agent-skill-id="${first.id}"]`);
    assert.doesNotMatch(await firstCard.innerText(), /builtin:\/\//);
    await firstCard.locator('[data-agent-action=edit-copy]').click();
    await editor(page).locator('[name=body]').fill('Unsubmitted local draft');
    const external = JSON.parse(await fs.readFile(original.storagePath, 'utf8'));
    external.skills.find(s=>s.id===first.id).body = 'New instructions from the external editor';
    const temporary = original.storagePath + '.' + tag + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(external), {flag:'wx'});
    try { await fs.rename(temporary, original.storagePath); }
    finally { await fs.rm(temporary, {force:true}); }
    await editor(page).getByRole('button', {name:'Save', exact:true}).click();
    await editor(page).getByRole('status').filter({hasText:'Copy changed'}).waitFor();
    assert.equal(await editor(page).locator('[name=body]').inputValue(), 'Unsubmitted local draft');
    assert.equal((await read(page)).skills.find(s => s.id === first.id).body, 'New instructions from the external editor');
    await assert.rejects(page.evaluate(s => invoke('agent_skill_remove', {id:s.id, expectedRevision:s.copy.revision}), first), /Refresh before removing/);
    await editor(page).locator('[name=name]').fill(forkName);
    await editor(page).getByRole('button', {name:'Save a separate copy'}).click();
    await editor(page).waitFor({state:'detached'});
    fork = (await read(page)).skills.find(s => s.name === forkName);
    assert.equal(fork.body, 'Unsubmitted local draft'); assert.equal(fork.enabled, false);
    assert.notEqual(first.id, fork.id);
    const forkCard = cards(page).locator(`[data-agent-skill-id="${fork.id}"]`);
    await forkCard.locator('[data-agent-action=edit-copy]').click();
    await editor(page).locator('[name=body]').fill('Revised independent draft');
    await editor(page).getByRole('button', {name:'Save', exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    fork = (await read(page)).skills.find(s => s.id === fork.id);
    assert.equal(fork.body, 'Revised independent draft'); assert.equal(fork.enabled, false);
    assert.ok(original.skills.filter(s=>s.enabled).length < 4, 'dedicated harness profile needs one free slot');
    await firstCard.locator('[data-agent-skill]').check();
    await page.waitForFunction(id=>!agentProfileBusy && currentAgentProfile(agentManagerRoot).skills.some(s=>s.id===id && s.enabled), first.id);
    await assert.rejects(page.evaluate(({first, a, addr}) => invoke('ai_plan', {request:{
      requestId:crypto.randomUUID(), endpoint:addr, model:'copy-fixture', apiKey:'', root:a, prompt:'Check stale skill',
      apiFormat:'anthropic-messages', generalChat:true, skillIds:[first.id], copyRevisions:{[first.id]:first.copy.revision},
    }}), {first,a,addr}), /Selected skill copy changed/);
    assert.equal(requests.length, 0);
    await page.locator('#agentProfileDialog footer [data-agent-action=close]').click();
    await page.evaluate(addr => { applyAiRuntimeSettings({endpoint:addr, model:'copy-fixture', apiFormat:'anthropic-messages'}, ''); aiStreamReplies=false; }, addr);
    await page.locator('#aiRoleBar summary').click(); await page.locator('#aiRoleSkills').check();
    await page.locator('#aiPrompt').fill('Use my documentation skill');
    await page.locator('#aiPrompt').press('Enter');
    await until(() => responses.length === 1);
    const skills = JSON.parse(requests[0].messages[0].content).background.skills;
    assert.ok(skills.length <= 4);
    assert.equal(skills.find(s=>s.id===first.id).body, 'New instructions from the external editor');
    assert.equal(skills.some(s=>s.id===sourceId), source.enabled);
    assert.ok(!skills.some(s=>s.id===fork.id));
    const next = (await read(page)).skills.find(s=>s.id===first.id);
    await page.evaluate(s=>invoke('agent_skill_save_copy', {input:{id:s.id, sourceId:s.copy.sourceId,
      expectedRevision:s.copy.revision, name:s.name, description:s.description, body:'Instructions for next turn'}}), next);
    responses[0].writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({
      role:'assistant', stop_reason:'end_turn', content:[{type:'text', text:'Copy reply'}],
    }));
    await page.waitForFunction(() => aiCurrentSession().messages.some(m=>m.text==='Copy reply'));
    await page.locator('#aiPrompt').fill('Use the updated copy'); await page.locator('#aiPrompt').press('Enter');
    await until(() => responses.length === 2);
    assert.equal(JSON.parse(requests[1].messages[0].content).background.skills.find(s=>s.id===first.id).body, 'Instructions for next turn');
    responses[1].writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({
      role:'assistant', stop_reason:'end_turn', content:[{type:'text', text:'Updated reply'}],
    }));
    await page.waitForFunction(() => aiCurrentSession().messages.some(m=>m.text==='Updated reply'));
    await close(); await launch(); page = getPage();
    const persisted = await read(page);
    assert.deepEqual(persisted.skills.find(s=>s.id===sourceId), source);
    assert.equal(persisted.skills.find(s=>s.id===fork.id).body, fork.body);
    assert.ok(persisted.skills.find(s=>s.id===first.id).enabled);
    await openSkills(page, a);
    await cards(page).locator(`[data-agent-skill-id="${fork.id}"] [data-agent-action=remove-skill]`).click();
    await cards(page).locator(`[data-agent-skill-id="${fork.id}"]`).waitFor({state:'detached'});
    assert.ok(!(await read(page)).skills.some(s=>s.id===fork.id));
  } finally {
    const current = await read(page);
    for (const item of current.skills.filter(s => [firstName,forkName].includes(s.name) && s.copy?.sourceId===sourceId)) {
      await page.evaluate(id => invoke('agent_skill_remove',{id}), item.id);
    }
    assert.deepEqual((await read(page)).skills.map(s => [s.id, s.name, s.description, s.body, s.enabled]), stamp);
  }
  console.log('Skill copies OK: cancel, external file change, stale draft recovery as a separate disabled copy, fresh process and actual model payload.');
};
