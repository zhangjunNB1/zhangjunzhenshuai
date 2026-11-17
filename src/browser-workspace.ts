import {BASE_KEY} from './github-workspace.ts';
import {STORAGE_KEY} from './workbench-model.ts';
import type {Workspace} from './workbench-model.ts';

const databaseName = 'mi-tv-workbench';
const storeName = 'workbench';
const draftKey = 'draft';
const recoveryKey = 'previous-draft';

export type Draft = {revision: string; workspace: string | null; base: string | null};

async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName,1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onblocked = () => reject(Error('本机资料被另一个页面占用，请关闭其它旧页面后重试。'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readBrowserDraft() {
  const db = await open();
  try {
    const draft = await new Promise<Draft | undefined>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(draftKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (draft) return draft;
    return {revision:'',workspace:localStorage.getItem(STORAGE_KEY),base:localStorage.getItem(BASE_KEY)};
  } finally {
    db.close();
  }
}

/** Commit the draft and its base version together, with a revision check across tabs. */
export async function saveBrowserDraft(workspace: Workspace, base: string, expected: string, recovery?: Workspace) {
  const db = await open();
  try {
    const revision = crypto.randomUUID();
    const record = {revision,workspace:JSON.stringify(workspace),base};
    await new Promise<void>((resolve,reject) => {
      const transaction = db.transaction(storeName,'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(draftKey);
      let conflict = false;
      request.onsuccess = () => {
        if ((request.result?.revision ?? '') !== expected) {
          conflict = true;
          transaction.abort();
          return;
        }
        if (recovery) store.put(JSON.stringify(recovery),recoveryKey);
        store.put(record,draftKey);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(conflict
        ? Error('另一个标签页已保存资料。请先导出当前备份，再刷新核对。')
        : (transaction.error ?? Error('浏览器资料存储失败。')));
    });
    // Retire old copies after an IndexedDB save succeeds, keeping migration recoverable.
    try { localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(BASE_KEY); } catch { /* IndexedDB is already committed. */ }
    return revision;
  } finally {
    db.close();
  }
}

export async function readRecoveryDraft() {
  const db = await open();
  try {
    return await new Promise<string | undefined>((resolve,reject)=>{
      const request = db.transaction(storeName).objectStore(storeName).get(recoveryKey);
      request.onsuccess = () => {
        try { resolve(request.result ?? localStorage.getItem(STORAGE_KEY+'-before-restore') ?? localStorage.getItem(STORAGE_KEY+'-before-cloud-load') ?? undefined); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
