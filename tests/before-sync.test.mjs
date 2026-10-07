import assert from 'node:assert/strict';
import { createBeforeSyncBackup } from '../before-sync.js';
import { defaultState } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';

const values=new Map(),getStorage=()=>({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
const key='backup',s=defaultState();s.teams[0].name='Crimson';s.notes[4]='Private reminder';
const backup=createBeforeSyncBackup({key,getStorage});backup.capture(s);
assert.deepEqual(JSON.parse(backup.raw),s);
const changed=defaultState();changed.teams[0].name='Shared name';backup.capture(changed);
assert.deepEqual(JSON.parse(backup.raw),s);
const reopened=createBeforeSyncBackup({key,getStorage});reopened.capture(changed);assert.equal(reopened.raw,backup.raw);
const current=defaultState();current.notes[4]='New private reminder';
const restored=mergePublicState(publicSnapshot(JSON.parse(backup.raw)),current);
assert.equal(restored.teams[0].name,'Crimson');assert.equal(restored.notes[4],'New private reminder');
console.log('PASS Original shared scores are retained across connection/reload and restore keeps current private notes');

const fresh=createBeforeSyncBackup({key:'fresh',getStorage});const privateOnly=defaultState();privateOnly.notes[4]='Private';fresh.capture(privateOnly);assert.equal(fresh.raw,null);fresh.capture(s);assert.equal(fresh.raw,null);
console.log('PASS Fresh viewers do not later create a misleading original backup from shared results');

const blocked=createBeforeSyncBackup({getStorage:()=>({getItem:()=>null,setItem:()=>{throw Error('Full');}})});
assert.throws(()=>blocked.capture(s),/could not be backed up/);blocked.capture(defaultState());assert.equal(blocked.raw,null);
console.log('PASS Meaningful original data is not replaced when its safety backup cannot be saved');

values.set('bad','{unfinished');const bad=createBeforeSyncBackup({key:'bad',getStorage});assert.ok(bad.error);assert.throws(()=>bad.capture(s));assert.equal(values.get('bad'),'{unfinished');
console.log('PASS Corrupt original backups remain intact');
assert.equal(bad.recoveryRaw,'{unfinished');bad.recover(s);assert.equal(bad.error,'');assert.deepEqual(JSON.parse(bad.raw),s);assert.equal(bad.recoveryRaw,null);
console.log('PASS Explicit recovery retains current scores and reconnects after the corrupt copy is exported');
