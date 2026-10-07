const SCROLL_CONTAINERS = ['score-table-wrap', 'bracket-scroll', 'committee-tabs', 'detail-tabs', 'round-strip'];

function locationFor(root, element) {
  if (element === root) return {root: true};
  let selector;
  if (element.id) selector = `#${CSS.escape(element.id)}`;
  else {
    // The saved value can change independently of a field's identity.
    const attributes = [...element.attributes].filter(attribute =>
      attribute.name.startsWith('data-') && attribute.name !== 'data-committed-value');
    if (attributes.length) {
      selector = element.tagName.toLowerCase() + attributes.map(attribute =>
        `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('');
    } else if (element.name) {
      selector = `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
    } else if (element.tagName === 'SUMMARY') {
      const parent = locationFor(root, element.parentElement);
      return parent && {summary: parent};
    } else if (element.classList.length) {
      selector = element.tagName.toLowerCase() + [...element.classList].map(name => `.${CSS.escape(name)}`).join('');
    } else selector = element.tagName.toLowerCase();
  }
  const index = [...root.querySelectorAll(selector)].indexOf(element);
  return index < 0 ? null : {selector, index};
}

function findAt(root, location) {
  if (!location) return null;
  if (location.root) return root;
  if (location.summary) return findAt(root, location.summary)?.querySelector('summary');
  return root.querySelectorAll(location.selector)[location.index] || null;
}

function committedValue(element) {
  return element.dataset.committedValue ?? element.defaultValue;
}

function editableValue(element) {
  return element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' &&
    !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden'].includes(element.type);
}

// Refresh a desk without dropping its draft, caret, open settings or scroll position.
export function captureView(root, viewKey) {
  const active = root.ownerDocument?.activeElement || document.activeElement;
  const focused = active && root.contains(active) ? active : null;
  const focus = focused && locationFor(root, focused);
  const draft = focused && editableValue(focused) ? {
    value: focused.value,
    baseline: committedValue(focused),
    start: focused.selectionStart,
    end: focused.selectionEnd,
    direction: focused.selectionDirection
  } : null;
  const liveKey = root.querySelector('[data-live-key]')?.dataset.liveKey;
  const details = [...root.querySelectorAll('details')].map(element => ({
    location: locationFor(root, element), open: element.open
  }));
  const scrollers = new Set([root, ...root.querySelectorAll('[id]')]);
  for (const className of SCROLL_CONTAINERS) {
    for (const element of root.querySelectorAll(`.${className}`)) scrollers.add(element);
  }
  const scroll = [...scrollers].map(element => {
    const className = element !== root && !element.id &&
      SCROLL_CONTAINERS.find(name => [...element.classList].includes(name));
    const selector = className && `.${className}`;
    const location = element === root || element.id || !selector ? locationFor(root, element) : {
      selector, index: [...root.querySelectorAll(selector)].indexOf(element)
    };
    return {location, top: element.scrollTop, left: element.scrollLeft};
  });

  return nextKey => {
    // A draft belongs to its panel and round, never the next match or department.
    if (viewKey !== nextKey || liveKey !== root.querySelector('[data-live-key]')?.dataset.liveKey) return;
    for (const saved of details) {
      const element = findAt(root, saved.location);
      if (element) element.open = saved.open;
    }
    for (const position of scroll) {
      const element = findAt(root, position.location);
      if (element) {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    }
    const replacement = findAt(root, focus);
    if (!replacement || replacement.disabled) return;
    if (draft && editableValue(replacement) && draft.baseline !== undefined &&
      committedValue(replacement) === draft.baseline) replacement.value = draft.value;
    replacement.focus({preventScroll: true});
    if (draft && replacement.value === draft.value && typeof draft.start === 'number' &&
      typeof replacement.setSelectionRange === 'function') {
      // Number inputs expose this method but reject text selection.
      try { replacement.setSelectionRange(draft.start, draft.end, draft.direction); } catch {}
    }
  };
}
