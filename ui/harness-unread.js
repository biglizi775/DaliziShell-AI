'use strict';

// Only one file surface is active. Clear the old badge synchronously on navigation;
// a reply from a previous IPC must never paint over the new owner.
let harnessBadgeButton=null, harnessBadgeKey='', harnessBadgeVersion=0;
function harnessUnreadTarget() {
  const tab=curTab();
  if(tab?.connection==='ssh') {
    const v=tab.sshFiles, button=tab.sshFilesPanel?.querySelector('[data-remote-ask]');
    const id=v?.taskBinding?.workspace.identity;
    if(button && id && v.ready && !v.busy && tab.sshAuthenticated && !tab.disposed && !tab.exited && !tab.sshDisconnectRequested)
      return {button,key:locale+':remote:'+id,query:{remoteWorkspace:id}};
    return null;
  }
  if(!tab || isTermTab(tab) || isBrowserTab(tab) || state.loading || state.error)return null;
  const root=aiBrowsingFolder(), button=$(aiPanelOpen?'harnessTasksButton':'btnAiAssistant');
  if(!root || !state.path || aiKey(root)!==aiKey(state.path) || !button)return null;
  return {button,key:locale+':local:'+root,query:{root}};
}
function paintHarnessUnread(button,count) {
  if(!button)return;
  let pill=button.querySelector('.harness-unread-count');
  if(!count){pill?.remove();return;}
  if(!pill){pill=document.createElement('span');pill.className='harness-unread-count';button.append(pill);}
  pill.textContent=projectText(count+' 条未读',count+' unread');
}
function syncHarnessUnread(force=false) {
  const target=harnessUnreadTarget(), key=target?.key||'';
  const changed=key!==harnessBadgeKey || (target?.button||null)!==harnessBadgeButton;
  if(!force && !changed)return;
  const version=++harnessBadgeVersion;
  if(changed)paintHarnessUnread(harnessBadgeButton,0);
  harnessBadgeButton=target?.button||null;harnessBadgeKey=key;
  if(!target)return;
  invoke('harness_unread_count',target.query).then(count=>{
    if(version===harnessBadgeVersion && Number.isSafeInteger(count))
      paintHarnessUnread(target.button,count);
  }).catch(()=>{if(version===harnessBadgeVersion)paintHarnessUnread(target.button,0);});
}
function initHarnessUnread() {
  listen('harness-results-changed',()=>{
    syncHarnessUnread(true);
    $('harnessTasksDialog')?.dispatchEvent(new Event('harness-history-changed'));
  },{target:'main'}).then(()=>syncHarnessUnread(true)).catch(()=>{});
  window.addEventListener('focus',()=>syncHarnessUnread(true));
}
