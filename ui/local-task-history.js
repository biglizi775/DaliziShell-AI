'use strict';

// A committed claim precedes Shell dispatch. A fresh window can never replay a
// running claim, even if the Shell finished just before the process stopped.
let localHistoryDb;
function openLocalHistoryDatabase() {
  if (!localHistoryDb) localHistoryDb = new Promise((resolve, reject) => {
    const request = indexedDB.open('dalizi-local-file-tasks', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('batches', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('items', { keyPath: ['batchId', 'index'] });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); localHistoryDb = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => { localHistoryDb = null; throw error; });
  return localHistoryDb;
}
function localRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function localTransaction(mode, run) {
  const db = await openLocalHistoryDatabase();
  const tx = db.transaction(['batches', 'items'], mode, mode === 'readwrite' ? { durability: 'strict' } : {});
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('File task transaction aborted'));
  });
  // Attach the completion listener before issuing any request. Both the
  // request error and the transaction abort can fire on a disk/quota failure.
  const work = Promise.resolve().then(() => run(tx.objectStore('batches'), tx.objectStore('items'))).catch(error => {
    try { tx.abort(); } catch (_) { /* already aborted */ }
    throw error;
  });
  const [result] = await Promise.all([work, done]);
  return result;
}
async function readLocalHistory() {
  const [headers, entries] = await localTransaction('readonly', (batches, items) =>
    Promise.all([localRequest(batches.getAll()), localRequest(items.getAll())]));
  const byId = new Map(headers.map(header => [header.id, { ...header, items: [], finished: true, restored: true }]));
  for (const row of entries) {
    const batch = byId.get(row.batchId); if (!batch) continue;
    let status = row.status;
    if (status === 'queued') status = 'stopped';
    if (!['complete', 'skipped', 'failed', 'stopped'].includes(status)) status = 'verify';
    batch.items.push({ ...row, status });
  }
  return [...byId.values()];
}
function countLocalRecords() {
  return localTransaction('readonly', batches => localRequest(batches.count()));
}
async function createLocalRecord(batch, previous = []) {
  return localTransaction('readwrite', async (batches, items) => {
    const id = await localRequest(batches.add({ kind: batch.kind, dest: batch.dest, destinationKey: batch.destinationKey, created: batch.created }));
    const writes = batch.items.map((row, index) => localRequest(items.add({
      batchId: id, index, source: row.source, sourceKey: row.sourceKey, status: row.status,
    })));
    await Promise.all(writes);
    // Claim the old retry entries and create the new batch in one commit.
    // An interrupted hand-off leaves exactly one recoverable owner.
    for (const [index, old] of previous.entries()) {
      const stored = await localRequest(items.get([old.batchId, old.index]));
      if (!stored || stored.retried || !['queued','failed','stopped'].includes(stored.status) ||
          stored.source !== batch.items[index].source || stored.sourceKey !== old.sourceKey) {
        throw new Error(localTaskText('原记录已变化，请重新打开任务面板。', 'The original record changed. Reopen the task panel.'));
      }
      const parent = await localRequest(batches.get(old.batchId));
      if (parent?.kind !== batch.kind || parent.dest !== batch.dest || parent.destinationKey !== batch.destinationKey) {
        throw new Error(localTaskText('原目标已变化，请重新核对。', 'The original destination changed.'));
      }
      await localRequest(items.put({ ...stored, retried: id }));
    }
    return id;
  });
}
async function writeLocalItem(item, before, after, receipt = {}) {
  return localTransaction('readwrite', async (_, items) => {
    const row = await localRequest(items.get([item.batchId, item.index]));
    if (!row || row.retried || row.status !== before) throw new Error(localTaskText('项目记录已变化，请核对。', 'The item record changed. Inspect the result.'));
    await localRequest(items.put({ ...row, status: after, target: receipt.target, message: receipt.message }));
  });
}
async function forgetLocalRecords(ids) {
  if (!ids.length) return;
  await localTransaction('readwrite', (batches, items) => Promise.all(ids.flatMap(id => [
    localRequest(batches.delete(id)),
    localRequest(items.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))),
  ])));
}
