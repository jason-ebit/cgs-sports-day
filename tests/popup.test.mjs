import assert from 'node:assert/strict';
import {createTimerPopup} from '../timer-popup.js';
import {makeClock,startClock} from '../timer-model.js';

class Surface {
  constructor(parent=null,rect={left:0,top:0,width:0,height:0}) {
    this.parent=parent;this.rect=rect;this.listeners=new Map();this.hidden=false;this.open=false;
    this.style={removeProperty(name){delete this[name];}};this.dataset={};this.attributes={};this.captures=new Set();
    const classes=new Set();
    this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)};
  }
  addEventListener(type,fn,options=false) {
    const listeners=this.listeners.get(type)||[];
    listeners.push({fn,capture:options===true||Boolean(options.capture)});this.listeners.set(type,listeners);
  }
  removeEventListener(type,fn,options=false) {
    const capture=options===true||Boolean(options.capture);
    this.listeners.set(type,(this.listeners.get(type)||[]).filter(listener=>listener.fn!==fn||listener.capture!==capture));
  }
  setAttribute(name,value){this.attributes[name]=value;}
  getBoundingClientRect(){const left=parseFloat(this.style.left)||this.rect.left,top=parseFloat(this.style.top)||this.rect.top;return {...this.rect,left,top,right:left+this.rect.width,bottom:top+this.rect.height};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);emit(this,'lostpointercapture',{pointerId:id});}
  close(){this.open=false;emit(this,'close');}
}
function emit(target,type,values={}) {
  const event={type,target,button:0,buttons:1,isPrimary:true,pointerType:'mouse',pointerId:1,detail:1,clientX:0,clientY:0,cancelable:true,defaultPrevented:false,...values,
    preventDefault(){if(this.cancelable)this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  const path=[];for(let node=target;node;node=node.parent)path.push(node);
  const call=(node,capture)=>{for(const listener of node.listeners.get(type)||[]){if(listener.capture===capture)listener.fn(event);if(event.stopped)return;}};
  for(const node of [...path].reverse()){call(node,true);if(event.stopped)return event;}
  for(const node of path){call(node,false);if(event.stopped)return event;}
  return event;
}
function fixture(fn) {
  const saved=new Map(['document','window','innerWidth','innerHeight','setTimeout','clearTimeout'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalNow=Date.now;let now=1000,nextTimer=0;const timers=new Map();
  const window=new Surface(),document=new Surface(window);
  const floating=new Surface(document,{left:650,top:620,width:300,height:50});floating.hidden=true;
  const overlay=new Surface(document,{left:180,top:60,width:640,height:580});overlay.open=true;
  const chip=new Surface(floating),hide=new Surface(floating),control=new Surface(overlay),input=new Surface(overlay);
  const zone=new Surface(document,{left:474,top:630,width:52,height:52}),liveZone=new Surface(overlay,{left:474,top:630,width:52,height:52});zone.hidden=liveZone.hidden=true;
  const elements={'#timer-float':floating,'#active-timer':chip,'#live-dialog':overlay,'#hide-timer':hide,'#timer-dropzone':zone,'#live-dropzone':liveZone};
  document.querySelector=selector=>elements[selector];
  Object.assign(globalThis,{window,document,innerWidth:1000,innerHeight:700,setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});Date.now=()=>now;
  const advance=milliseconds=>{const end=now+milliseconds;for(;;){const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].callback();}now=end;};
  let hidden=0;const popup=createTimerPopup({onHide:()=>hidden++});popup.update('relay:0','All teams — 01:00');
  try{fn({window,document,floating,overlay,chip,hide,control,input,zone,liveZone,popup,advance,hidden:()=>hidden});}
  finally{Date.now=originalNow;for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
}
const tests=[];
function test(name,fn){try{fixture(fn);tests.push({name,pass:true});}catch(error){tests.push({name,pass:false,error:error.stack});}}
const touch=(x,y,id=7)=>({identifier:id,clientX:x,clientY:y});
const noActiveTouchListeners=(...surfaces)=>{for(const surface of surfaces)for(const type of ['touchmove','touchend','touchcancel'])assert.equal((surface.listeners.get(type)||[]).length,0,`${type} listener was not removed`);};

test('A quick control tap keeps its default action and click',({window,control,liveZone})=>{
  let taps=0;control.addEventListener('click',()=>taps++);
  assert.equal(emit(control,'pointerdown',{clientX:300,clientY:200}).defaultPrevented,false);
  assert.equal(emit(window,'pointerup',{clientX:300,clientY:200}).defaultPrevented,false);
  assert.equal(emit(control,'click',{clientX:300,clientY:200}).defaultPrevented,false);
  assert.equal(taps,1);assert.equal(liveZone.hidden,true);
});
test('Small pointer jitter stays a tap and leaves the popup in place',({window,control,overlay,liveZone})=>{
  emit(control,'pointerdown',{clientX:300,clientY:200});
  assert.equal(emit(window,'pointermove',{clientX:303,clientY:203}).defaultPrevented,false);
  emit(window,'pointerup',{clientX:303,clientY:203});
  assert.equal(emit(control,'click',{clientX:303,clientY:203}).defaultPrevented,false);
  assert.equal(overlay.style.left,undefined);assert.equal(liveZone.hidden,true);
});
test('Dragging from the timer text moves the entire floating timer',({window,chip,floating,zone})=>{
  emit(chip,'pointerdown',{clientX:700,clientY:640});
  assert.equal(emit(window,'pointermove',{clientX:600,clientY:590}).defaultPrevented,true);
  assert.equal(floating.style.left,'550px');assert.equal(floating.style.top,'570px');assert.equal(zone.hidden,false);
  emit(window,'pointerup',{clientX:600,clientY:590});assert.equal(zone.hidden,true);
});
test('Dragging a scoring control moves the popup without scoring; the next press works',({window,control,overlay})=>{
  let points=0;control.addEventListener('click',()=>points++);
  emit(control,'pointerdown',{clientX:300,clientY:200});emit(window,'pointermove',{clientX:380,clientY:240});emit(window,'pointerup',{clientX:380,clientY:240});
  assert.equal(overlay.style.left,'260px');assert.equal(overlay.style.top,'100px');
  const draggedClick=emit(control,'click',{clientX:380,clientY:240});assert.equal(draggedClick.defaultPrevented,true);assert.equal(draggedClick.stopped,true);assert.equal(points,0);
  emit(control,'pointerdown',{clientX:380,clientY:240});emit(window,'pointerup',{clientX:380,clientY:240});
  assert.equal(emit(control,'click',{clientX:380,clientY:240}).defaultPrevented,false);assert.equal(points,1);
});
test('Touch swiping before the hold leaves native scrolling untouched',({window,control,overlay,liveZone,advance})=>{
  assert.equal(emit(control,'touchstart',{touches:[touch(300,200)]}).defaultPrevented,false);advance(100);
  assert.equal(emit(control,'touchmove',{touches:[touch(300,170)]}).defaultPrevented,false);advance(300);
  assert.equal(emit(control,'touchend',{touches:[],changedTouches:[touch(300,170)]}).defaultPrevented,false);
  assert.equal(overlay.style.left,undefined);assert.equal(liveZone.hidden,true);assert.equal(overlay.classList.contains('is-dragging'),false);noActiveTouchListeners(control,window);
});
test('A quick touch tap and slight touch jitter keep normal controls',({window,control,overlay,advance})=>{
  emit(control,'touchstart',{touches:[touch(300,200)]});advance(80);
  assert.equal(emit(control,'touchmove',{touches:[touch(302,201)]}).defaultPrevented,false);
  assert.equal(emit(control,'touchend',{touches:[],changedTouches:[touch(302,201)]}).defaultPrevented,false);
  assert.equal(emit(control,'click',{clientX:302,clientY:201,pointerId:7}).defaultPrevented,false);assert.equal(overlay.style.left,undefined);noActiveTouchListeners(control,window);
});
test('Touch holding then dragging a control moves the popup and prevents a tap',({control,overlay,liveZone,advance})=>{
  emit(control,'touchstart',{touches:[touch(300,200)]});advance(250);assert.equal(liveZone.hidden,false);
  assert.equal(emit(control,'touchmove',{touches:[touch(360,230)]}).defaultPrevented,true);
  assert.equal(overlay.style.left,'240px');assert.equal(overlay.style.top,'90px');
  assert.equal(emit(control,'touchend',{touches:[],changedTouches:[touch(360,230)]}).defaultPrevented,true);
  assert.equal(emit(control,'click',{clientX:360,clientY:230,pointerId:7}).defaultPrevented,true);assert.equal(liveZone.hidden,true);
});
test('A stationary touch hold does not accidentally activate the pressed control',({control,advance})=>{
  emit(control,'touchstart',{touches:[touch(300,200)]});advance(300);
  assert.equal(emit(control,'touchend',{touches:[],changedTouches:[touch(300,200)]}).defaultPrevented,true);
  assert.equal(emit(control,'click',{clientX:300,clientY:200,pointerId:7}).defaultPrevented,true);
});
test('Dragging continues when the original touch target is removed by a timer-body refresh',({window,control,overlay,liveZone,advance})=>{
  emit(control,'touchstart',{touches:[touch(300,200)]});advance(250);control.parent=null;
  assert.equal(emit(control,'touchmove',{touches:[touch(360,230)]}).defaultPrevented,true);
  assert.equal(overlay.style.left,'240px');assert.equal(overlay.style.top,'90px');
  assert.equal(emit(control,'touchend',{touches:[],changedTouches:[touch(360,230)]}).defaultPrevented,true);
  assert.equal(liveZone.hidden,true);assert.equal(overlay.classList.contains('is-dragging'),false);
  noActiveTouchListeners(control,window);
});
test('Active touch dragging also survives browser retargeting through the window',({window,control,overlay,liveZone,advance})=>{
  emit(control,'touchstart',{touches:[touch(300,200)]});advance(250);control.parent=null;
  assert.equal(emit(window,'touchmove',{touches:[touch(360,230)]}).defaultPrevented,true);assert.equal(overlay.style.left,'240px');
  assert.equal(emit(window,'touchend',{touches:[],changedTouches:[touch(360,230)]}).defaultPrevented,true);assert.equal(liveZone.hidden,true);
});
test('Pressing the dialog backdrop cannot move the timer with mouse or touch',({window,overlay,liveZone,advance})=>{
  emit(overlay,'pointerdown',{clientX:10,clientY:10});assert.equal(emit(window,'pointermove',{clientX:100,clientY:100}).defaultPrevented,false);emit(window,'pointerup',{clientX:100,clientY:100});
  emit(overlay,'touchstart',{touches:[touch(10,10)]});advance(300);assert.equal(liveZone.hidden,true);
  assert.equal(emit(overlay,'touchmove',{touches:[touch(100,100)]}).defaultPrevented,false);
  assert.equal(emit(overlay,'touchend',{touches:[],changedTouches:[touch(100,100)]}).defaultPrevented,false);
  assert.equal(overlay.style.left,undefined);assert.equal(overlay.open,true);
});
test('Dropping in the red circle center hides the mini timer while its clock remains intact',({window,chip,floating,popup,hidden})=>{
  const clocks={'relay:0':makeClock(60)};startClock(clocks,'relay:0',1000);const before=JSON.stringify(clocks);
  emit(chip,'pointerdown',{clientX:700,clientY:640});emit(window,'pointermove',{clientX:500,clientY:656});emit(window,'pointerup',{clientX:500,clientY:656});
  assert.equal(floating.hidden,true);assert.equal(hidden(),1);assert.equal(JSON.stringify(clocks),before);
  popup.update('relay:0','All teams — 00:59');assert.equal(floating.hidden,true);popup.reveal();assert.equal(floating.hidden,false);
});
test('A corner outside the visible red circle never dismisses the popup',({window,control,overlay,liveZone})=>{
  emit(control,'pointerdown',{clientX:300,clientY:200});emit(window,'pointermove',{clientX:475,clientY:631});
  assert.equal(liveZone.classList.contains('ready'),false);emit(window,'pointerup',{clientX:475,clientY:631});assert.equal(overlay.open,true);
});
test('Releasing in the red circle closes the big popup',({window,control,overlay,liveZone})=>{
  emit(control,'pointerdown',{clientX:300,clientY:200});emit(window,'pointermove',{clientX:500,clientY:656});
  assert.equal(liveZone.classList.contains('ready'),true);emit(window,'pointerup',{clientX:500,clientY:656});assert.equal(overlay.open,false);assert.equal(liveZone.hidden,true);
});
test('Pointer cancellation, blur and lost capture clear dragging without dismissal',({window,control,overlay,liveZone})=>{
  for(const cancel of ['pointercancel','blur','lostpointercapture']){
    emit(control,'pointerdown',{clientX:300,clientY:200});emit(window,'pointermove',{clientX:500,clientY:656});
    emit(cancel==='lostpointercapture'?overlay:window,cancel,{clientX:500,clientY:656});
    assert.equal(overlay.open,true);assert.equal(liveZone.hidden,true);assert.equal(overlay.classList.contains('is-dragging'),false);assert.equal(overlay.hasPointerCapture(1),false);
  }
});
test('Touch cancellation, a second finger and a non-cancelable move never dismiss',({window,control,overlay,liveZone,advance})=>{
  for(const cancel of ['touchcancel','second-touch','native-scroll']){
    emit(control,'touchstart',{touches:[touch(300,200)]});advance(250);
    if(cancel==='touchcancel')emit(control,'touchcancel');
    if(cancel==='second-touch')emit(control,'touchstart',{touches:[touch(300,200),touch(320,200,8)]});
    if(cancel==='native-scroll')emit(control,'touchmove',{touches:[touch(500,656)],cancelable:false});
    assert.equal(overlay.open,true);assert.equal(liveZone.hidden,true);assert.equal(overlay.classList.contains('is-dragging'),false);noActiveTouchListeners(control,window);
  }
});
test('Keyboard movement works on either timer surface without hijacking controls',({floating,chip,overlay,control,input})=>{
  for(const child of [input,control,chip])assert.equal(emit(child,'keydown',{key:'ArrowRight'}).defaultPrevented,false);
  assert.equal(overlay.style.left,undefined);assert.equal(floating.style.left,undefined);
  assert.equal(emit(overlay,'keydown',{key:'ArrowRight'}).defaultPrevented,true);assert.equal(overlay.style.left,'196px');
  assert.equal(emit(floating,'keydown',{key:'ArrowLeft'}).defaultPrevented,true);assert.equal(floating.style.left,'634px');
});
test('Timer keyboard movement leaves unrelated and modified shortcuts alone',({overlay})=>{
  for(const values of [{key:'Enter'},{key:'ArrowLeft',altKey:true},{key:'ArrowRight',ctrlKey:true},{key:'ArrowDown',metaKey:true}])assert.equal(emit(overlay,'keydown',values).defaultPrevented,false);
  assert.equal(overlay.style.left,undefined);assert.equal(overlay.style.top,undefined);
});
test('The popup remains within the viewport when dragged or resized',({window,control,overlay})=>{
  emit(control,'pointerdown',{clientX:300,clientY:200});emit(window,'pointermove',{clientX:2000,clientY:2000});emit(window,'pointerup',{clientX:2000,clientY:2000});
  assert.equal(overlay.style.left,'352px');assert.equal(overlay.style.top,'112px');
  globalThis.innerWidth=800;globalThis.innerHeight=650;emit(window,'resize');assert.equal(overlay.style.left,'152px');assert.equal(overlay.style.top,'62px');
});

for(const result of tests)console.log(`${result.pass?'PASS':'FAIL'} ${result.name}${result.error?'\n'+result.error:''}`);
if(tests.some(result=>!result.pass))process.exitCode=1;
