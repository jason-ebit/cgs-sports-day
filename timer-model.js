export const MATCH_KEYS = ['prelim','semi1','semi2','final'];
export const MATCH_NAMES = {prelim:'Preliminary',semi1:'Semifinal 1',semi2:'Semifinal 2',final:'Final'};
export const TIMER_KEY = /^(event:(?:[0-9]|1[0-4])|tug:(prelim|semi1|semi2|final)|borrow:[0-6]|basket:(red|blue|yellow|green|white):[01]|relay:[0-2]|cavalry:(women|men))$/;
export function makeClock(seconds=0, signature='') { return {duration:seconds*1000,remaining:seconds*1000,deadline:null,signature,started:false}; }
export function remainingMs(clock, now=Date.now()) { return Math.max(0,clock.deadline===null?clock.remaining:clock.deadline-now); }
export function pauseClock(clock, now=Date.now()) { clock.remaining=remainingMs(clock,now);clock.deadline=null; }
export function startClock(clocks,key,now=Date.now()) {
  const clock=clocks[key];if(!clock||remainingMs(clock,now)<=0)return false;
  if(clock.deadline!==null){clock.started=true;return true;}
  for(const [id,c] of Object.entries(clocks)) if(id!==key&&c.deadline!==null)pauseClock(c,now);
  clock.deadline=now+clock.remaining;clock.started=true;return true;
}
export function addTime(clock,seconds,now=Date.now()) {
  const remaining=Math.min(86400000,remainingMs(clock,now)+seconds*1000);
  clock.remaining=remaining;if(clock.deadline!==null)clock.deadline=now+remaining;
}
export function resetClock(clock,seconds=clock.duration/1000) { clock.duration=seconds*1000;clock.remaining=seconds*1000;clock.deadline=null;clock.started=false; }
export function formatTime(ms) {const seconds=Math.ceil(Math.max(0,ms)/1000);return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
export function validateClocks(input) {
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>50)throw Error('Invalid saved timers.');
  const result={};let running=0;
  for(const [key,c] of Object.entries(input)) {
    if(!TIMER_KEY.test(key)||!c||![c.duration,c.remaining].every(n=>Number.isInteger(n)&&n>=0&&n<=86400000)||!(c.deadline===null||(Number.isSafeInteger(c.deadline)&&c.deadline>0))||typeof c.signature!=='string'||c.signature.length>160)throw Error('Invalid saved timer.');
    if(c.started!==undefined&&typeof c.started!=='boolean')throw Error('Invalid saved timer.');
    if(c.started===false&&c.deadline!==null)throw Error('A running timer must have been started.');
    if(c.deadline!==null)running++;
    result[key]={duration:c.duration,remaining:c.remaining,deadline:c.deadline,signature:c.signature,started:c.started??(c.deadline!==null||c.remaining<c.duration)};
  }
  if(running>1)throw Error('Only one event timer can run at once.');
  return result;
}
