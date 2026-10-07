import { GAME_IDS, gameDone } from './model.js?v=19';
import { remainingMs } from './timer-model.js?v=19';

const EVENTS = [4, 5, 7, 8, 9];
const SVG_NS = 'http://www.w3.org/2000/svg';
const gameForKey = key => {
  const [prefix, value] = String(key || '').split(':');
  return GAME_IDS.includes(prefix) ? prefix : prefix === 'event' ? GAME_IDS[EVENTS.indexOf(Number(value))] ?? null : null;
};

export function gameTimelineState(state, { now = Date.now() } = {}) {
  const complete = GAME_IDS.map(id => gameDone(state, id));
  const running = Object.entries(state.timers).find(([, clock]) => clock.deadline !== null && remainingMs(clock, now) > 0);
  const selectedKey = running?.[0] ?? (state.timers[state.activeKey]?.started ? state.activeKey : null);
  const selected = gameForKey(selectedKey), activeIndex = GAME_IDS.findIndex((id, i) => id === selected && !complete[i]);
  const nextIndex = complete.findIndex((done, i) => !done && (activeIndex === -1 || i > activeIndex));
  const steps = GAME_IDS.map((id, i) => ({
    id, number: i + 1, eventIndex: EVENTS[i],
    status: complete[i] ? 'completed' : i === activeIndex ? 'active' : i === nextIndex ? 'next' : 'upcoming',
    running: i === activeIndex && Boolean(running),
  }));
  const segments = steps.slice(0, -1).map((from, i) => {
    const to = steps[i + 1];
    const status = from.status === 'completed' && to.status === 'completed' ? 'completed'
      : from.status === 'active' || to.status === 'active' || (from.number === 1 && from.status === 'next') || (from.status === 'completed' && to.status === 'next') ? 'current' : 'upcoming';
    return { from: from.id, to: to.id, status };
  });
  return { steps, segments, completed: complete.filter(Boolean).length,
    active: activeIndex === -1 ? null : GAME_IDS[activeIndex], next: nextIndex === -1 ? null : GAME_IDS[nextIndex] };
}

const round = n => Math.round(n * 100) / 100;
const point = ([x, y]) => `${round(x)} ${round(y)}`;
const midpoint = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

// The four curves stay in the existing gaps, including the return from the
// upper-right card to the lower-left card. No added row or outer gutter is needed.
export function gameTimelineGeometry(cardRects, gridRect) {
  if (!gridRect || gridRect.width <= 0 || gridRect.height <= 0 || cardRects.length !== 5) return [];
  const width = gridRect.layoutWidth ?? gridRect.width, height = gridRect.layoutHeight ?? gridRect.height;
  if (width <= 0 || height <= 0) return [];
  const scaleX = width / gridRect.width, scaleY = height / gridRect.height;
  const cards = cardRects.map(r => ({
    left: (r.left - gridRect.left) * scaleX, top: (r.top - gridRect.top) * scaleY,
    width: r.width * scaleX, height: r.height * scaleY,
  }));
  if (cards.some(r => Object.values(r).some(n => !Number.isFinite(n)) || r.width <= 0 || r.height <= 0)) return [];
  return cards.slice(0, -1).map((from, i) => {
    const to = cards[i + 1], lower = to.top >= from.top + from.height - .5;
    let start, end, control1, control2, gap;
    if (lower) {
      start = [from.left + from.width / 2, from.top + from.height];
      end = [to.left + to.width / 2, to.top];
      const y = (start[1] + end[1]) / 2;
      control1 = [start[0], y]; control2 = [end[0], y]; gap = end[1] - start[1];
    } else {
      start = [from.left + from.width, from.top + from.height / 2];
      end = [to.left, to.top + to.height / 2];
      const x = (start[0] + end[0]) / 2;
      control1 = [x, start[1]]; control2 = [x, end[1]]; gap = end[0] - start[0];
    }
    const centre = midpoint(start, end);
    return { from: GAME_IDS[i], to: GAME_IDS[i + 1], start, end, control1, control2,
      d: `M ${point(start)} C ${point(control1)} ${point(control2)} ${point(end)}`,
      dot: { x: centre[0], y: centre[1], radius: Math.min(3, Math.max(0, gap) / 3) }, gap };
  });
}

export function createGameTimeline({
  getState, container, now = () => Date.now(),
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
  ResizeObserver: Observer = globalThis.ResizeObserver,
  reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  timers = globalThis, window: windowSurface = globalThis.window,
} = {}) {
  if (!container || typeof getState !== 'function') throw Error('The game timeline needs the Games grid and current scores.');
  const document = container.ownerDocument;
  let frame = null, svg = null, firstDraw = true, settleTimer = null, destroyed = false;
  const node = (tag, attrs = {}) => {
    const result = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
    return result;
  };
  function render() {
    frame = null;
    if (destroyed) return;
    const cards = EVENTS.map(index => container.querySelector(`.game-card[data-open="event:${index}"]`));
    if (cards.some(card => !card)) return;
    const progress = gameTimelineState(getState(), { now: now() });
    for (const [i, card] of cards.entries()) {
      const status = progress.steps[i].status;
      card.dataset.timelineState = status;
      card.setAttribute('aria-description', `Game ${i + 1} of 5. ${({ completed: 'Complete.', active: 'Ongoing game.', next: 'Next up.', upcoming: 'Coming up.' })[status]}`);
    }
    const bounds = container.getBoundingClientRect();
    const width = container.clientWidth || bounds.width, height = container.clientHeight || bounds.height;
    const paths = gameTimelineGeometry(cards.map(card => card.getBoundingClientRect()), { ...bounds,
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, layoutWidth: width, layoutHeight: height });
    if (!paths.length || paths.some(path => path.gap < 0)) { if (svg) svg.style.display = 'none'; return; }
    if (!svg || svg.parentNode !== container) {
      svg = node('svg', { class: 'game-timeline', 'aria-hidden': 'true', focusable: 'false' });
      if (firstDraw && !reducedMotion()) {
        svg.classList.add('is-drawing');
        if (settleTimer !== null) timers.clearTimeout(settleTimer);
        const drawingSvg = svg;
        settleTimer = timers.setTimeout(() => { drawingSvg.classList.remove('is-drawing'); settleTimer = null; }, 2600);
      }
      firstDraw = false;
      container.append(svg);
    }
    svg.style.display = '';
    svg.setAttribute('viewBox', `0 0 ${round(width)} ${round(height)}`);
    svg.setAttribute('data-completed', progress.completed);
    const children = [];
    for (const [i, geometry] of paths.entries()) {
      const status = progress.segments[i].status;
      const path = node('path', { d: geometry.d, pathLength: 1,
        class: `game-timeline-link game-timeline-link--${status}`, 'data-game-from': geometry.from, 'data-game-to': geometry.to });
      path.style.setProperty('--timeline-order', i);
      children.push(path);
      if (geometry.dot.radius >= 1) children.push(node('circle', { cx: round(geometry.dot.x), cy: round(geometry.dot.y),
        r: round(geometry.dot.radius), class: `game-timeline-dot game-timeline-dot--${status}` }));
    }
    svg.replaceChildren(...children);
  }
  function update() { if (!destroyed && frame === null) frame = requestFrame(render); }
  const observer = typeof Observer === 'function' ? new Observer(update) : null;
  if (observer) observer.observe(container);
  else windowSurface?.addEventListener('resize', update);
  function destroy() {
    destroyed = true;
    if (frame !== null) cancelFrame(frame);
    if (settleTimer !== null) timers.clearTimeout(settleTimer);
    observer?.disconnect(); windowSurface?.removeEventListener('resize', update);
    svg?.remove();
    for (const card of container.querySelectorAll('.game-card')) {
      delete card.dataset.timelineState;
      if (/^Game [1-5] of 5\./.test(card.getAttribute('aria-description') || '')) card.removeAttribute('aria-description');
    }
  }
  return { update, destroy };
}
