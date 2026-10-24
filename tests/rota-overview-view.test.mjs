import assert from 'node:assert/strict';
import {renderDutyOverview} from '../rota-overview-view.js';

const person=(id,name,department,status='duty')=>({id,name,department,status});
const jason=person('director:0','Jason','director'),lanny=person('first-aid:0','Lanny','first-aid');
const rina=person('equipment:0','Rina','equipment'),timothy=person('equipment:1','Timothy','equipment');
const cindy=person('food-water:0','Cindy','food-water'),maria=person('food-water:2','Maria','food-water');
const jenni=person('comms:0','Jenni','comms'),mario=person('comms:1','Mario','comms');
const shift={id:'borrow:pair:0',roundKeys:['borrow:0','borrow:1'],label:'Rounds 1–2',plannedStart:'12:40',plannedEnd:'12:46',handoverSeconds:60,
  stations:[{department:'director',minimum:1,staff:[jason],shortfall:0},{department:'first-aid',minimum:1,staff:[lanny],shortfall:0},{department:'judges',minimum:0,staff:[],shortfall:0},{department:'equipment',minimum:2,staff:[rina,timothy],shortfall:0},{department:'food-water',minimum:1,staff:[cindy],shortfall:0},{department:'comms',minimum:1,staff:[jenni],shortfall:0}],
  freeToPlay:[maria,mario],unassigned:[],warnings:[],handover:{nextShiftId:'borrow:pair:1',nextLabel:'Rounds 3–4',departments:[{department:'food-water',incoming:[maria],outgoing:[cindy],staying:[]},{department:'comms',incoming:[mario],outgoing:[jenni],staying:[]}]}};
const model={fixedPosts:[{department:'director',staff:[jason]},{department:'first-aid',staff:[lanny]}],games:[{id:'borrow',label:'Borrow-a-Thing',shifts:[shift]},{id:'basket',label:'Ball Basket',shifts:[]}],warnings:[]};

const html=renderDutyOverview(model,{editable:true,openGameId:'borrow'});
assert.match(html,/data-rota-overview-game="borrow" open/);
assert.match(html,/data-rota-overview-game="basket">/);
assert.equal((html.match(/>Jason</g)||[]).length,1,'Fixed posts are named once and kept above the game list');
assert.equal((html.match(/>Lanny</g)||[]).length,1);
assert.ok(!html.includes('<dt>Assistant judge</dt>'),'An empty optional assistant does not look like covered duty');
for(const text of ['Equipment','Food &amp; water','Comm','Rina','Timothy','Cindy','Jenni','Available to play','Maria','Mario'])assert.ok(html.includes(text),text);
assert.ok(html.indexOf('<dt>Equipment</dt>')<html.indexOf('<dt>Food &amp; water</dt>'));
assert.match(html,/Maria takes over from Cindy/);
assert.match(html,/Mario takes over from Jenni/);
assert.match(html,/60 sec handover/);
assert.match(html,/data-rota-edit-round="borrow:0" data-rota-edit-game="borrow"/);
assert.ok(!renderDutyOverview(model).includes('data-rota-edit-round='),'Viewers get the whole plan without edit actions');
assert.ok(!html.includes('data-rota-status='),'The game overview does not duplicate the person editor');
assert.ok(!html.includes('Same crew for the next shift.'),'Changing crews show the actual incoming and outgoing people');
console.log('PASS Named crews, fixed posts, real-round editing and role-specific handovers are clear');

const split=structuredClone(model);
const changed=split.games[0].shifts[0];
changed.label='Round 1';changed.roundKeys=['borrow:0'];changed.start=null;changed.end=null;changed.plannedStart=null;changed.plannedEnd=null;changed.blockStart='12:40';changed.blockEnd='12:46';changed.timingReason='split-assignments';
changed.stations[1]={department:'first-aid',minimum:1,staff:[],pendingStaff:[{...rina,status:'cover',coveringName:'Lanny',confirmation:'training'}],shortfall:1};
changed.freeToPlay=[maria];changed.blockedFromPlay=[lanny];changed.unassigned=[mario];
const splitHTML=renderDutyOverview(split,{editable:true});
assert.ok(splitHTML.includes('Within 12:40–12:46 <small>shared block</small>'));
assert.match(splitHTML,/Rina covering Lanny: first aid and CPR skills need confirmation/);
assert.match(splitHTML,/1 person needed/);
assert.ok(splitHTML.includes('Needs cover before playing:</strong> Lanny'));
assert.ok(splitHTML.includes('Not assigned:</strong> Mario'));
assert.ok(splitHTML.includes('<dt>First aid</dt><dd><span class="duty-empty">No one assigned'),'A changed fixed post is shown in the affected shift');
console.log('PASS Split windows and unconfirmed cover never imply that a protected post is safely covered');

const betweenGames=structuredClone(model);
betweenGames.games[0].shifts[0].handover={...shift.handover,crossGame:true,nextGameLabel:'Cavalry Game',nextLabel:'Women’s round'};
const crossHTML=renderDutyOverview(betweenGames);
assert.ok(crossHTML.includes('Next game: Cavalry Game · Women’s round'));
assert.ok(!crossHTML.includes('60 sec handover'),'A later game after a break is not represented as an immediate timed swap');
console.log('PASS Next-game handovers show the next named crew without inventing a timed swap across breaks');

const unsafe=structuredClone(model);
unsafe.fixedPosts[0].staff[0].name='<img src=x onerror=alert(1)>';
unsafe.games[0].label='<script>unsafe</script>';
unsafe.games[0].shifts[0].warnings=['<b>Review</b>'];
unsafe.games[0].shifts[0].handover.nextLabel='" onclick="bad';
const escaped=renderDutyOverview(unsafe,{editable:true});
assert.ok(!escaped.includes('<img'));
assert.ok(!escaped.includes('<script>'));
assert.ok(!escaped.includes('<b>Review</b>'));
assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(escaped.includes('&lt;b&gt;Review&lt;/b&gt;'));
assert.ok(escaped.includes('&quot; onclick=&quot;bad'));
assert.ok(renderDutyOverview({games:[]}).includes('No games to show.'));
console.log('PASS Saved names, game labels, warnings and handover labels are escaped');
