import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderedSchedule, scheduleBounds, EVENT_GAMES } from '../content.js';
import { googleCalendarLink } from '../calendar-link.js';

const event=JSON.parse(readFileSync(new URL('../schedule.json',import.meta.url),'utf8'));
const ordered=orderedSchedule(event.schedule);
function test(name,run){run();console.log(`PASS ${name}`);}
const minutes=time=>{const [h,m]=time.split(':').map(Number);return h*60+m;};

test('Setup and CG-IN precede registration with the agreed forty-minute slots',()=>{
  assert.deepEqual(ordered.slice(0,3).map(({title,start,end,durationMinutes})=>({title,start,end,durationMinutes})),[
    {title:'Committee Setup',start:'11:00',end:'11:40',durationMinutes:40},
    {title:'CG-IN',start:'11:40',end:'12:20',durationMinutes:40},
    {title:'Registration / Team Draw',start:'12:20',end:'12:35',durationMinutes:15},
  ]);
});
test('The recalibrated rundown is continuous and preserves all later durations',()=>{
  assert.deepEqual(ordered.slice(3).map(e=>e.durationMinutes),[3,5,20,25,20,45,35,30,10,10,10,10,0]);
  ordered.forEach((e,i)=>{
    assert.equal(minutes(e.end)-minutes(e.start),e.durationMinutes,e.title);
    if(i)assert.equal(e.start,ordered[i-1].end,`${e.title} must follow the previous slot`);
  });
  assert.deepEqual(scheduleBounds(event.schedule),{start:'11:00',end:'16:18'});
  assert.equal(ordered.at(-1).title,'Finish');
});
test('Moving CG-IN keeps saved event notes, timers and game IDs at their original indices',()=>{
  assert.equal(ordered[1].eventIndex,15);
  assert.deepEqual(Object.entries(EVENT_GAMES).map(([index,game])=>[game,event.schedule[index].title]),[
    ['borrow','Borrow-a-Thing'],['basket','Ball Basket'],['cavalry','Cavalry Game'],['tug','Tug-of-War'],['relay','Team Relay'],
  ]);
});
test('Calendar uses the event date and full Korea-time span with the revised arrival details',()=>{
  const params=new URL(googleCalendarLink(event)).searchParams;
  assert.equal(params.get('dates'),'20261025T020000Z/20261025T071800Z');
  assert.equal(params.get('stz'),'Asia/Seoul');
  assert.equal(params.get('etz'),'Asia/Seoul');
  assert.equal(params.get('location'),event.venue);
  for(const detail of ['Committee Setup: 11:00–11:40.','CG-IN: 11:40–12:20.','Registration / Team Draw: 12:20–12:35.'])assert.ok(params.get('details').includes(detail));
});
test('The date card and no-script calendar fallback match the schedule',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const fallback=html.match(/id="calendar-link" href="([^"]+)"/)[1].replaceAll('&amp;','&');
  assert.equal(fallback,googleCalendarLink(event));
  assert.match(html,/<span id="event-time">11:00 – 16:18<\/span>/);
  assert.match(html,/October 25, 2026, 11:00 to 16:18 Korea time/);
});
test('Calendar and shared range follow changed schedule data rather than fixed display times',()=>{
  const changed=structuredClone(event);
  changed.schedule[0].start='10:30';
  changed.schedule[14].end='16:30';
  assert.deepEqual(scheduleBounds(changed.schedule),{start:'10:30',end:'16:30'});
  assert.equal(new URL(googleCalendarLink(changed)).searchParams.get('dates'),'20261025T013000Z/20261025T073000Z');
});
