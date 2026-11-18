'use strict';

let agentSkillEditor = null;
function openAgentSkillEditor(id) {
  if (agentSkillEditor) { agentSkillEditor.focus(); return; }
  const profile = currentAgentProfile(agentManagerRoot);
  const skill = profile?.skills.find(item => item.id === id);
  if (!skill || (!agentSkillIsBuiltin(skill) && !skill.copy)) return;
  const copy = skill.copy, sourceId = copy?.sourceId || id;
  const createId = 'copy-' + crypto.randomUUID();
  const dialog = document.createElement('dialog');
  dialog.id = 'agentSkillEditor'; dialog.className = 'agent-profile-dialog agent-memory-dialog';
  dialog.setAttribute('aria-labelledby', 'agentSkillEditorTitle');
  const t = agentProfileText;
  const fork = copy
    ? `<button type="submit" value="fork" class="agent-profile-secondary">${esc(t('saveSeparateCopy'))}</button>` : '';
  dialog.innerHTML = `<header class="agent-profile-heading"><div><h2 id="agentSkillEditorTitle">${esc(t(copy ? 'editSkillCopy' : 'createSkillCopy'))}</h2><p>${esc(t(copy ? 'editCopyHint' : 'createCopyHint'))}</p></div></header>
    <form><div class="agent-profile-body agent-skill-fields">
      <label>${esc(t('copyName'))}<input name="name" required></label>
      <label>${esc(t('copyDescription'))}<textarea name="description" rows="2"></textarea></label>
      <label>${esc(t('copyBody'))}<textarea name="body" rows="10" required spellcheck="false"></textarea></label>
      <p class="agent-profile-error" role="status" aria-live="polite"></p>
    </div><footer class="agent-profile-footer"><button type="button" data-copy-cancel class="agent-profile-secondary">${esc(t('cancel'))}</button>
      <button type="submit" class="agent-profile-primary">${esc(t('saveCopy'))}</button>${fork}</footer></form>`;
  document.body.appendChild(dialog);
  agentSkillEditor = dialog;
  const form = dialog.querySelector('form'), fields = form.elements;
  const initial = agentSkillPresentation(skill);
  fields.name.value = copy ? skill.name : t('copyNamePattern').replace('{name}', initial.name);
  fields.description.value = copy ? skill.description : initial.description;
  fields.body.value = skill.body;
  const status = dialog.querySelector('[role=status]');
  let busy = false;
  dialog.querySelector('[data-copy-cancel]').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => { agentSkillEditor = null; dialog.remove(); }, {once:true});
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const editing = copy && event.submitter?.value !== 'fork';
    const input = {id:editing ? id : createId, sourceId, expectedRevision:editing ? copy.revision : null,
      name:fields.name.value.trim(), description:fields.description.value.trim(), body:fields.body.value};
    if (copy && !editing) input.baseCopy = {id, version:copy.version};
    if (!input.name || !input.body.trim() || Array.from(input.name).length > 100 ||
        Array.from(input.description).length > 600 || new TextEncoder().encode(input.body).length > 65536) {
      status.textContent = t('copyLimits'); return;
    }
    busy = true;
    for (const field of fields) field.disabled = true;
    status.textContent = t('pending');
    try {
      await invoke('agent_skill_save_copy', {input});
    } catch (error) {
      status.textContent = String(error);
      for (const field of fields) field.disabled = false;
      busy = false; return;
    }
    agentExpandedSkill = input.id;
    try {
      await refreshAgentProfiles();
      setAgentProfileStatus(t(editing ? 'saved' : 'copyCreated'));
    } catch (error) { setAgentProfileStatus(t('saved') + ' · ' + String(error), true); }
    dialog.close();
    agentManager.querySelector(`[data-agent-skill-id="${input.id}"]`)?.scrollIntoView({block:'nearest'});
  };
  dialog.showModal();
  fields.name.focus();
}
