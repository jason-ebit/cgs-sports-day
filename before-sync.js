import { defaultState } from './model.js?v=24';
import { publicSnapshot } from './sync.js?v=24';

// Retain the original device data once, before adopting shared results.
export function createBeforeSyncBackup({ key = 'cg-sports-day-before-sync:cgs-oct25', getStorage = () => globalThis.localStorage } = {}) {
  let record = null, error = '', recoveryRaw = null;
  try {
    const raw = getStorage().getItem(key);
    recoveryRaw = raw;
    if (raw !== null) {
      record = JSON.parse(raw);
      if (record?.joined !== true || !(record.raw === null || typeof record.raw === 'string')) throw Error('Invalid recovery backup.');
    }
  } catch { error = 'The original phone backup could not be read. Export your current backup before connecting.'; }
  function capture(state) {
    if (error) throw Error(error);
    if (record) return;
    const meaningful = JSON.stringify(publicSnapshot(state)) !== JSON.stringify(publicSnapshot(defaultState()));
    const next = { joined: true, raw: meaningful ? JSON.stringify(state, null, 2) : null };
    try { getStorage().setItem(key, JSON.stringify(next)); record = next; }
    catch {
      if (meaningful) throw Error('The original phone scores could not be backed up. Download a backup before connecting.');
      record = next;
    }
  }
  function recover(state) {
    const next={joined:true,raw:JSON.stringify(state,null,2)};
    try{getStorage().setItem(key,JSON.stringify(next));record=next;error='';recoveryRaw=null;}
    catch{throw Error('Phone storage is still unavailable. Allow browser storage before reconnecting.');}
  }
  return { capture, recover, get raw() { return record?.raw ?? null; }, get recoveryRaw() { return recoveryRaw; }, get error() { return error; } };
}
