// Moving or hiding a timer never changes its clock or scores.
export function createTimerPopup({ onHide }) {
  const floating=document.querySelector('#timer-float');
  const chip=document.querySelector('#active-timer');
  const overlay=document.querySelector('#live-dialog');
  let activeKey=null,hiddenKey=null;
  let blockedClick=null;
  const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));

  // A drag can finish over a scoring button. Consume its generated click before
  // any timer or score handler sees it; the next deliberate press works normally.
  document.addEventListener('pointerdown',()=>{blockedClick=null;},true);
  document.addEventListener('click',event=>{
    if(!blockedClick||event.detail===0||Date.now()>blockedClick.until)return;
    const samePointer=event.pointerId!==undefined&&event.pointerId===blockedClick.id;
    const samePlace=Math.hypot(event.clientX-blockedClick.x,event.clientY-blockedClick.y)<12;
    if(!samePointer&&!samePlace)return;
    blockedClick=null;event.preventDefault();event.stopImmediatePropagation();
  },true);

  function position(element,x,y){
    const rect=element.getBoundingClientRect();
    element.style.left=clamp(x,8,innerWidth-rect.width-8)+'px';
    element.style.top=clamp(y,8,innerHeight-rect.height-8)+'px';
    element.style.right='auto';
    element.style.bottom='auto';
    element.style.margin='0';
  }
  function drag(element,handle,target,dismiss){
    let start=null;
    const inside=point=>{const r=element.getBoundingClientRect();return point.clientX>=r.left&&point.clientX<=r.right&&point.clientY>=r.top&&point.clientY<=r.bottom;};
    const overTarget=point=>{const r=target.getBoundingClientRect();return point&&Math.hypot(point.clientX-r.left-r.width/2,point.clientY-r.top-r.height/2)<=Math.min(r.width,r.height)/2;};
    const arm=()=>{
      if(!start)return;
      start.armed=true;target.hidden=false;element.classList.add('is-dragging');
    };
    const begin=(kind,id,point)=>{
      if(start)return;
      const rect=element.getBoundingClientRect();
      start={kind,id,x:point.clientX,y:point.clientY,left:rect.left,top:rect.top,moved:false,armed:false,hold:null,unlisten:null};
      if(kind==='touch')start.hold=setTimeout(arm,250);
    };
    const move=point=>{
      const dx=point.clientX-start.x,dy=point.clientY-start.y;
      if(!start.moved&&Math.hypot(dx,dy)<6)return;
      if(!start.armed)arm();
      start.moved=true;
      position(element,start.left+dx,start.top+dy);
      target.classList.toggle('ready',overTarget(point));
    };
    const finish=(point,cancel=false)=>{
      if(!start)return;
      const gesture=start;start=null;clearTimeout(gesture.hold);gesture.unlisten?.();
      const remove=!cancel&&gesture.moved&&overTarget(point);
      if(gesture.armed)blockedClick={id:gesture.kind==='pointer'?gesture.id:undefined,x:point?.clientX??gesture.x,y:point?.clientY??gesture.y,until:Date.now()+700};
      target.hidden=true;target.classList.remove('ready');element.classList.remove('is-dragging');
      if(gesture.kind==='pointer'&&element.hasPointerCapture(gesture.id))element.releasePointerCapture(gesture.id);
      if(remove)dismiss();
    };
    element.addEventListener('pointerdown',event=>{
      // Touch uses its native events so a quick swipe can still scroll the body.
      if(event.pointerType==='touch'||event.button!==0||event.isPrimary===false)return;
      if(event.target===element&&!inside(event))return;
      begin('pointer',event.pointerId,event);
    },true);
    window.addEventListener('pointermove',event=>{
      if(!start||start.kind!=='pointer'||event.pointerId!==start.id)return;
      if(event.buttons===0){finish(event,true);return;}
      move(event);
      if(start.armed){element.setPointerCapture(event.pointerId);event.preventDefault();}
    });
    window.addEventListener('pointerup',event=>{
      if(start?.kind==='pointer'&&event.pointerId===start.id)finish(event);
    });
    window.addEventListener('pointercancel',event=>{
      if(start?.kind==='pointer'&&event.pointerId===start.id)finish(event,true);
    });
    element.addEventListener('lostpointercapture',event=>{
      if(start?.kind==='pointer'&&event.pointerId===start.id)finish(event,true);
    });
    const seenTouch=new WeakSet();
    const touchMove=event=>{
      if(!start||start.kind!=='touch')return;
      if(seenTouch.has(event))return;seenTouch.add(event);
      if(event.touches.length!==1){finish(null,true);return;}
      const point=Array.from(event.touches).find(t=>t.identifier===start.id);
      if(!point)return;
      if(!start.armed){
        // Moving before the hold is an ordinary swipe, with native momentum.
        if(Math.hypot(point.clientX-start.x,point.clientY-start.y)>=6)finish(point,true);
        return;
      }
      if(!event.cancelable){finish(point,true);return;}
      event.preventDefault();move(point);
    };
    const touchEnd=event=>{
      if(!start||start.kind!=='touch')return;
      const point=Array.from(event.changedTouches).find(t=>t.identifier===start.id);
      if(!point)return;
      if(start.armed)event.preventDefault();
      finish(point);
    };
    const touchCancel=()=>finish(null,true);
    element.addEventListener('touchstart',event=>{
      blockedClick=null;
      if(event.touches.length!==1){finish(null,true);return;}
      if(start)return;
      const point=event.touches[0];
      if(event.target===element&&!inside(point))return;
      begin('touch',point.identifier,point);
      // Expiry can replace the pressed score button. Its detached touch target
      // must keep receiving this gesture, with window as a retargeting fallback.
      const surfaces=[event.target,window],listeners=[['touchmove',touchMove],['touchend',touchEnd],['touchcancel',touchCancel]];
      for(const surface of surfaces)for(const [type,handler] of listeners)surface.addEventListener(type,handler,{passive:false,capture:true});
      start.unlisten=()=>{for(const surface of surfaces)for(const [type,handler] of listeners)surface.removeEventListener(type,handler,true);};
    },{passive:true,capture:true});
    window.addEventListener('touchstart',event=>{
      if(start?.kind==='touch'&&event.touches.length!==1)finish(null,true);
    },{passive:true,capture:true});
    element.addEventListener('contextmenu',event=>{if(start?.armed)event.preventDefault();});
    element.addEventListener('dragstart',event=>{if(start)event.preventDefault();});
    element.addEventListener('close',()=>finish(null,true));
    window.addEventListener('blur',()=>finish(null,true));
    handle.addEventListener('keydown',event=>{
      const steps={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
      if(!steps[event.key])return;
      event.preventDefault();const rect=element.getBoundingClientRect(),[x,y]=steps[event.key];
      position(element,rect.left+x,rect.top+y);
    });
  }
  const hide=()=>{hiddenKey=activeKey;floating.hidden=true;onHide();};
  document.querySelector('#hide-timer').addEventListener('click',hide);
  drag(floating,document.querySelector('#timer-grip'),document.querySelector('#timer-dropzone'),hide);
  drag(overlay,document.querySelector('#live-grip'),document.querySelector('#live-dropzone'),()=>overlay.close());
  window.addEventListener('resize',()=>{
    [floating,overlay].forEach(element=>{
      if(element.style.left&&(!element.hidden&&(element!==overlay||overlay.open))){const rect=element.getBoundingClientRect();position(element,rect.left,rect.top);}
    });
  });
  return {
    update(key,text){
      activeKey=key;floating.hidden=!key||hiddenKey===key;
      if(key){chip.textContent=text;chip.dataset.key=key;chip.setAttribute('aria-label','Open ongoing game: '+text);}
    },
    reveal(){hiddenKey=null;floating.hidden=!activeKey;},
    resetOverlay(){['left','top','right','bottom','margin'].forEach(name=>overlay.style.removeProperty(name));}
  };
}
