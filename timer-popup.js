// Moving or hiding a timer never changes its clock or scores.
export function createTimerPopup({ onHide }) {
  const floating=document.querySelector('#timer-float');
  const chip=document.querySelector('#active-timer');
  const overlay=document.querySelector('#live-dialog');
  let activeKey=null,hiddenKey=null;
  const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));

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
    const finish=(event,cancel=false)=>{
      if(!start||event.pointerId!==start.id)return;
      const remove=!cancel&&start.moved&&target.classList.contains('ready');
      target.hidden=true;target.classList.remove('ready');element.classList.remove('is-dragging');
      handle.releasePointerCapture(event.pointerId);
      start=null;
      if(remove)dismiss();
    };
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      const rect=element.getBoundingClientRect();
      start={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};
      handle.setPointerCapture(event.pointerId);event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(!start||event.pointerId!==start.id)return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if(!start.moved&&Math.hypot(dx,dy)<5)return;
      start.moved=true;target.hidden=false;element.classList.add('is-dragging');
      position(element,start.left+dx,start.top+dy);
      const zone=target.getBoundingClientRect();
      target.classList.toggle('ready',event.clientX>=zone.left&&event.clientX<=zone.right&&event.clientY>=zone.top&&event.clientY<=zone.bottom);
    });
    handle.addEventListener('pointerup',event=>finish(event));
    handle.addEventListener('pointercancel',event=>finish(event,true));
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
