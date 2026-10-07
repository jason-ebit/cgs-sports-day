// Keep a desk refresh from interrupting keyboard controls or closing its settings.
export function captureView(root, viewKey) {
  const active = document.activeElement;
  const selection = active && typeof active.selectionStart === 'number' ? {start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,value:active.value} : null;
  let focusSelector = null;
  if (active && root.contains(active)) {
    if (active.id) focusSelector = `#${CSS.escape(active.id)}`;
    else {
      const attributes = [...active.attributes].filter(attr => attr.name.startsWith('data-'));
      if (attributes.length) focusSelector = active.tagName.toLowerCase() + attributes.map(attr => `[${attr.name}="${CSS.escape(attr.value)}"]`).join('');
      else if (active.tagName === 'SUMMARY' && active.parentElement.classList.length) {
        focusSelector = `details.${[...active.parentElement.classList].map(name => CSS.escape(name)).join('.')} > summary`;
      }
    }
  }
  const liveKey = root.querySelector('[data-live-key]')?.dataset.liveKey;
  const openDetails = [...root.querySelectorAll('details[open]')].map(details => [...details.classList]);
  const scroll = [...root.querySelectorAll('[id]'), root].map(element => ({id: element.id, top: element.scrollTop, left: element.scrollLeft}));
  return nextKey => {
    if (viewKey === nextKey && liveKey === root.querySelector('[data-live-key]')?.dataset.liveKey) {
      for (const classes of openDetails) {
        if (classes.length) root.querySelector(`details.${classes.map(name => CSS.escape(name)).join('.')}`)?.setAttribute('open', '');
      }
      for (const position of scroll) {
        const element = position.id === root.id ? root : root.querySelector(`#${CSS.escape(position.id)}`);
        if (element) { element.scrollTop = position.top; element.scrollLeft = position.left; }
      }
    }
    const replacement = focusSelector && root.querySelector(focusSelector);
    if (replacement && !replacement.disabled) {
      replacement.focus({preventScroll: true});
      if(selection&&replacement.value===selection.value&&replacement.setSelectionRange)replacement.setSelectionRange(selection.start,selection.end,selection.direction);
    }
  };
}
