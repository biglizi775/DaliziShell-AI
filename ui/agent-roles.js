'use strict';

function agentRoleText(zh, en) { return locale === 'en' ? en : zh; }

function roleSkillPreview(profile, role, useRecommendations) {
  const effective = profile.skills.filter(skill => skill.enabled);
  const suggestions = role.suggestedSkills.map(id => profile.skills.find(skill => skill.id === id && skill.source === 'builtin')).filter(Boolean);
  const pending = [];
  for (const skill of suggestions) {
    if (effective.some(item => item.id === skill.id || item.copy?.sourceId === skill.id)) continue;
    if (useRecommendations && effective.length < 4) effective.push(skill);
    else pending.push(skill);
  }
  return {effective, pending};
}

function changeAgentRole(role, useSkills) {
  const session = aiCurrentSession();
  if (!session || session.restoring || !role) return;
  if ((session.agentRole?.id || 'general') === role.id && !!session.useRoleSkills === useSkills) return;
  discardSessionPlans(session, 'superseded', true);
  session.agentRole = role;
  session.useRoleSkills = useSkills;
  session.roleGeneration = (session.roleGeneration || 0) + 1;
  if (role.access !== 'standard') {
    session.autoTab = null;
    if (session.permissionMode !== 'read-only') {
      session.permissionMode = 'read-only';
      if (typeof setHarnessEditMode === 'function') setHarnessEditMode(session.root, 'read-only');
    }
  }
  if (role.access === 'advice') {
    session.projectTools = false;
    session.editReference = '';
    session.subfolderSelection = null;
  }
  session.activation++;
  session.revision++;
  renderAiSelection(); renderAiConversation(); updateAiComposer();
}

function renderAgentRole() {
  const bar = $('aiRoleBar');
  if (!bar) return;
  const session = aiCurrentSession(), profile = session && currentAgentProfile(session.root);
  bar.hidden = !profile?.roles?.length;
  if (bar.hidden) return;
  const role = profile.roles.find(item => item.id === (session.agentRole?.id || 'general'));
  if (!role) return;
  const name = item => agentRoleText(item.nameZh, item.nameEn);
  const select = bar.querySelector('select'), toggle = bar.querySelector('input');
  const catalogKey = JSON.stringify(profile.roles.map(item => [item.id, name(item)]));
  if (select.dataset.catalog !== catalogKey) {
    select.replaceChildren(...profile.roles.map(item => new Option(name(item), item.id)));
    select.dataset.catalog = catalogKey;
  }
  select.value = role.id;
  select.disabled = !!session.restoring;
  select.setAttribute('aria-label', agentRoleText('对话角色', 'Conversation role'));
  toggle.checked = !!session.useRoleSkills;
  toggle.disabled = !!session.restoring || (!role.suggestedSkills.length && !toggle.checked);
  bar.querySelector('[data-role-toggle-label]').textContent = agentRoleText('本对话采用角色推荐技能', 'Use role skills in this chat');
  bar.querySelector('[data-role-description]').textContent = agentRoleText(role.descriptionZh, role.descriptionEn);
  const {effective, pending} = roleSkillPreview(profile, role, toggle.checked);
  bar.querySelector('summary').textContent = agentRoleText('本轮技能', 'Turn skills') + ' · ' + effective.length + '/4';
  const names = skills => skills.map(skill => agentSkillPresentation(skill).name).join(' / ');
  bar.querySelector('[data-role-effective]').textContent = agentRoleText('将发送：', 'Will send: ') + (names(effective) || agentRoleText('无', 'None'));
  bar.querySelector('[data-role-pending]').textContent = pending.length
    ? (toggle.checked ? agentRoleText('名额已满，待加入：', 'Slots full, pending: ') : agentRoleText('可选推荐：', 'Suggested: ')) + names(pending) : '';
}

function initAgentRoles() {
  $('aiRoleBar').addEventListener('change', event => {
    const session = aiCurrentSession(), bar = event.currentTarget;
    if (!session) return;
    const role = currentAgentProfile(session.root)?.roles?.find(item => item.id === bar.querySelector('select').value);
    if (role) changeAgentRole(role, bar.querySelector('input').checked);
  });
}
