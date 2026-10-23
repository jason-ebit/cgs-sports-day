// Read-only geometry checks. Panels and controls are exercised manually.
const frame = document.querySelector('iframe');
const status = document.querySelector('#status');
if (new URLSearchParams(location.search).has('viewer')) {
  frame.src = '../';
  document.querySelector('#preview-mode').textContent = 'Live viewer inspection. Stay signed out while checking the login form and public layout.';
}
const label = element => element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`;
const inspections = new Map();
const initialSize = new URLSearchParams(location.search).get('size');
if ([...document.querySelector('#size').options].some(option => option.value === initialSize)) {
  document.querySelector('#size').value = initialSize;
  const [width,height]=initialSize.split(',');
  frame.style.width=`${width}px`;frame.style.height=`${height}px`;
}

function measure() {
  const d = frame.contentDocument, w = frame.contentWindow;
  if (!d?.body || !d.querySelector('.game-card')) return;
  const visible = element => element.getClientRects().length && w.getComputedStyle(element).visibility !== 'hidden';
  const modal = [...d.querySelectorAll('dialog[open]')].at(-1);
  const root = modal || d.body;
  const issues = [];
  if (modal) {
    const rect = modal.getBoundingClientRect();
    if (rect.left < -1 || rect.right > frame.clientWidth + 1) issues.push(`Dialog extends outside viewport horizontally`);
    if (rect.top < -1 || rect.bottom > frame.clientHeight + 1) issues.push(`Dialog extends outside viewport vertically`);
  }
  for (const element of root.querySelectorAll('*')) {
    if (!visible(element) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      ['INPUT','SELECT','TEXTAREA','SCRIPT','STYLE','OPTION'].includes(element.tagName)) continue;
    const style = w.getComputedStyle(element);
    if (element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0 &&
      style.overflowX === 'visible' && (element.children.length === 0 || element.tagName === 'BUTTON') && element.textContent.trim()) {
      issues.push(`${label(element)}: text is ${element.scrollWidth - element.clientWidth}px wider than its box`);
    }
    if (element.scrollHeight > element.clientHeight + 2 && style.overflowY === 'hidden' &&
      style.textOverflow !== 'ellipsis' && element.children.length === 0 && element.textContent.trim()) {
      issues.push(`${label(element)}: clipped vertically by ${element.scrollHeight - element.clientHeight}px`);
    }
  }
  const header = ['.wordmark-logo','.wordmark-caption','#sync-label'].map(selector => {
    const element = d.querySelector(selector);
    if (!element || !visible(element)) return null;
    const rect = element.getBoundingClientRect();
    return `${selector}: center ${(rect.top + rect.height / 2).toFixed(2)}px`;
  }).filter(Boolean);
  const crown = d.querySelector('.leader-crown'), heading = d.querySelector('.team-legend h2');
  if (!modal && crown && visible(crown) && heading) {
    const c = crown.getBoundingClientRect(), h = heading.getBoundingClientRect();
    if (c.left < h.right && c.right > h.left && c.top < h.bottom && c.bottom > h.top) issues.push('Leader crown overlaps TEAM COLOURS heading');
  }
  const width = d.documentElement.scrollWidth, height = d.documentElement.scrollHeight;
  if (width > frame.clientWidth + 1) issues.unshift(`Page overflow: ${width - frame.clientWidth}px horizontally`);
  if (!modal && d.body.classList.contains('fit-home') && height > frame.clientHeight + 1) issues.unshift(`Home overflow: ${height - frame.clientHeight}px vertically`);
  if (!modal && height > frame.clientHeight + 1) {
    for (const selector of ['.toolbar','#poster-viewport','#poster','#home-shortcuts','.poster-header','.poster-columns','.poster-footer','#timer-float']) {
      const element=d.querySelector(selector);if(!element||!visible(element))continue;
      const r=element.getBoundingClientRect();
      issues.push(`${selector}: top ${r.top.toFixed(1)}, bottom ${r.bottom.toFixed(1)}, height ${r.height.toFixed(1)}, content ${element.scrollHeight}`);
    }
  }
  const selection = modal ? [root.querySelector('.detail-tabs .active')?.textContent,root.querySelector('.committee-tabs .selected')?.textContent].filter(Boolean) : [d.body.dataset.homeView,d.body.classList.contains('fit-home')?'fit':'expanded'].filter(Boolean);
  const view=`${modal?.getAttribute('aria-labelledby') ? d.getElementById(modal.getAttribute('aria-labelledby')).textContent : 'Home'}${selection.length ? ' / '+selection.join(' / ') : ''}`;
  status.textContent = `Viewport ${frame.clientWidth} × ${frame.clientHeight}; document ${width} × ${height}\nView: ${view}\n${header.join('\n')}\n${issues.length ? issues.join('\n') : 'No unintended text or page overflow detected.'}`;
  const key=`${frame.clientWidth} × ${frame.clientHeight} · ${view}`;
  inspections.set(key,issues.length?issues.join('; '):'OK');
  const history=document.querySelector('#inspection-history');
  if(history)history.textContent=[...inspections].map(([view,result])=>`${view}: ${result}`).join('\n');
}

function setViewport(value) {
  document.querySelector('#size').value=value;
  const [width,height] = value.split(',');
  frame.style.width = `${width}px`; frame.style.height = `${height}px`;
  requestAnimationFrame(() => requestAnimationFrame(measure));
}
document.querySelector('#size').addEventListener('change', event => setViewport(event.target.value));
document.querySelectorAll('[data-viewport]').forEach(button => button.addEventListener('click',()=>setViewport(button.dataset.viewport)));
document.querySelector('#measure').addEventListener('click', measure);
frame.addEventListener('load', async () => {
  const d = frame.contentDocument;
  await d.fonts.ready;
  const afterLayout = () => requestAnimationFrame(() => requestAnimationFrame(measure));
  let queued=false;
  new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;measure();});
  }).observe(d.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class','hidden','aria-pressed','viewBox','d']});
  if (d.querySelector('.game-card')) { afterLayout(); return; }
  const ready = new MutationObserver(() => {
    if (!d.querySelector('.game-card')) return;
    ready.disconnect(); afterLayout();
  });
  ready.observe(d.body, {childList:true,subtree:true});
});
