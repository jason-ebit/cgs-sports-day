import assert from 'node:assert/strict';
import { defaultState } from '../model.js';
import { renderRotationPlanner } from '../rota-planner-ui.js';

const tests=[];
function test(name,run){run();tests.push(name);}

test('A preview never offers a write action to a viewer',()=>{
  const state=defaultState();
  const draft={summary:{plannedRounds:2,preservedRounds:0,skippedRounds:0,people:[]},warnings:[]};
  const html=renderRotationPlanner(state,{draft,editable:false});
  assert.ok(html.includes('Plan preview'));
  assert.ok(!html.includes('data-action="apply-rotation-plan"'));
  assert.ok(!html.includes('data-action="preview-rotation-plan"'));
  assert.ok(!html.includes('data-rota-plan-setting='));
});

test('Relief controls exclude critical staff and require explicit confirmation',()=>{
  const state=defaultState();
  state.committeeMembers.director[0]='Main Judge';
  state.committeeMembers.judges[0]='Assistant Judge';
  state.committeeMembers['first-aid']=['Kit Person','Field Person'];
  const html=renderRotationPlanner(state,{editable:true});
  for(const id of ['director:0','judges:0','first-aid:0','first-aid:1'])assert.ok(!html.includes(`<option value="${id}"`));
  assert.ok(html.includes('<option value="comms:0"'));
  assert.match(html,/data-rota-plan-setting="firstAidReliefConfirmed"\s+disabled/);
  assert.ok(!html.includes('data-action="apply-rotation-plan"'));
});

test('A preview escapes saved names and warning text',()=>{
  const state=defaultState();
  state.committeeMembers.comms[0]='<img src=x onerror=alert(1)>';
  const draft={summary:{plannedRounds:1,preservedRounds:2,skippedRounds:3,people:[{id:'comms:0',name:state.committeeMembers.comms[0],department:'comms',playingTurns:1,dutyTurns:2,coverTurns:3}]},warnings:['<script>alert(1)</script>']};
  const html=renderRotationPlanner(state,{draft,editable:true});
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('data-action="apply-rotation-plan"'));
});

test('A plan with no changed rounds cannot be applied',()=>{
  const draft={summary:{plannedRounds:0,preservedRounds:2,skippedRounds:3,people:[]},warnings:[]};
  const html=renderRotationPlanner(defaultState(),{draft,editable:true});
  assert.match(html,/data-action="apply-rotation-plan" disabled/);
});

console.log(`${tests.length} rotation planner UI tests passed.`);
