import assert from 'node:assert/strict';
import { renderLiveConnection } from '../connection-badge.js';

class Element {
  constructor(document) {
    this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.className='';
    this.classList={add:name=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' ');}};
  }
  setAttribute(name,value){this.attributes[name]=value;}
  prepend(element){this.children.unshift(element);}
  append(element){this.children.push(element);}
  querySelector(selector){return this.children.find(child=>selector==='.connection-light'?child.className==='connection-light':selector==='#sync-label'?child.id==='sync-label':Object.hasOwn(child.dataset,'connectionLabel'))??null;}
}
function fixture(){
  const document={createElement:()=>new Element(document)},button=new Element(document),label=new Element(document);
  label.id='sync-label';button.append(label);
  return {button,label,render:status=>renderLiveConnection(button,Object.freeze(status))};
}

const tests=[];
function test(name,run){try{run();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error});}}

test('Confirmed viewer scores show Live with a green light and a viewing description',()=>{
  const {button,label,render}=fixture();render({connected:true,phase:'watching',role:'viewer',pending:0,remoteAvailable:true});
  assert.equal(label.textContent,'Live');assert.equal(button.dataset.connectionTone,'live');
  assert.match(button.attributes['aria-label'],/Watching confirmed shared scores/);
  assert.equal(button.children[0].attributes['aria-hidden'],'true');
});
test('The scorekeeper gets the same Live label with synced detail',()=>{
  const {button,label,render}=fixture();render({connected:true,phase:'synced',role:'writer',pending:0});
  assert.equal(label.textContent,'Live');assert.match(button.title,/results are synced/);
});
test('Disconnecting replaces the live signal and describes pending local results',()=>{
  const {button,label,render}=fixture();render({connected:true,phase:'watching'});
  render({connected:false,phase:'pending',pending:2});
  assert.equal(label.textContent,'Offline');assert.equal(button.dataset.connectionTone,'offline');
  assert.match(button.title,/2 updates pending on this phone/);
  assert.equal(button.children.filter(child=>child.className==='connection-light').length,1);
});
test('An open connection never marks unconfirmed scoring as live',()=>{
  const {button,label,render}=fixture();
  render({connected:true,phase:'syncing',role:'writer',pending:1});
  assert.equal(label.textContent,'Syncing');assert.equal(button.dataset.connectionTone,'attention');
  render({connected:true,phase:'pending',role:'writer',pending:1});assert.equal(label.textContent,'Pending');
  render({connected:true,phase:'conflict',role:'writer',pending:1});assert.equal(label.textContent,'Review');
  assert.match(button.title,/review before scoring can continue/);
});
test('A storage failure clears the live signal even when the server is reachable',()=>{
  const {button,label,render}=fixture();render({connected:true,phase:'synced',storageError:true});
  assert.equal(label.textContent,'Review');assert.equal(button.dataset.connectionTone,'attention');
  assert.match(button.title,/Phone storage needs attention/);
});
test('Startup and an unconfigured scoreboard remain static while connecting',()=>{
  const {button,label,render}=fixture();render({connected:false,phase:'connecting'});
  assert.equal(label.textContent,'Connecting');assert.equal(button.dataset.connectionTone,'offline');
  render({connected:true,phase:'watching',remoteAvailable:false});
  assert.equal(label.textContent,'Connecting');assert.equal(button.dataset.connectionTone,'offline');
});
test('Reconnection restores Live without replacing the existing label or adding dots',()=>{
  const {button,label,render}=fixture();render({connected:false,phase:'offline'});
  render({connected:true,phase:'watching',pending:0});render({connected:true,phase:'watching',pending:0});
  assert.equal(label.textContent,'Live');assert.equal(button.dataset.connectionTone,'live');
  assert.equal(button.querySelector('#sync-label'),label);assert.equal(button.children.length,2);
});

for(const test of tests)console.log(`${test.passed?'PASS':'FAIL'} ${test.name}${test.error?'\n'+test.error.stack:''}`);
if(tests.some(test=>!test.passed))process.exitCode=1;
