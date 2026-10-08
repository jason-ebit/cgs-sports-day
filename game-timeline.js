import { GAME_IDS, gameDone } from './model.js?v=31';
import { remainingMs } from './timer-model.js?v=31';
import { roundDone } from './rounds.js?v=31';

const EVENTS = [4, 5, 7, 8, 9];
const SVG_NS = 'http://www.w3.org/2000/svg';
const gameForKey = key => {
  const [prefix, value] = String(key || '').split(':');
  return GAME_IDS.includes(prefix) ? prefix : prefix === 'event' ? GAME_IDS[EVENTS.indexOf(Number(value))] ?? null : null;
};

export function gameTimelineState(state, { now = Date.now() } = {}) {
  const complete = GAME_IDS.map(id => gameDone(state, id));
  const unfinished = key => !roundDone(state, key) && !gameDone(state, key.split(':')[0]);
  const ongoing = Object.entries(state.timers).find(([key, clock]) => clock.deadline !== null && unfinished(key));
  const selectedKey = ongoing?.[0] ?? (state.timers[state.activeKey]?.started && unfinished(state.activeKey) ? state.activeKey : null);
  const running = Boolean(ongoing && remainingMs(ongoing[1], now) > 0);
  const selected = gameForKey(selectedKey), activeIndex = GAME_IDS.findIndex((id, i) => id === selected && !complete[i]);
  const nextIndex = complete.findIndex((done, i) => !done && (activeIndex === -1 || i > activeIndex));
  const steps = GAME_IDS.map((id, i) => ({
    id, number: i + 1, eventIndex: EVENTS[i],
    status: complete[i] ? 'completed' : i === activeIndex ? 'active' : i === nextIndex ? 'next' : 'upcoming',
    running: i === activeIndex && running,
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
const curveMidpoint = (start, c1, c2, end) => [0, 1].map(i => (start[i] + 3 * c1[i] + 3 * c2[i] + end[i]) / 8);

// Follow the measured card positions rather than their DOM order. The compact
// layout runs right, down, left, then down into Relay; every bow stays in a gap.
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
    const to = cards[i + 1];
    const below = to.top >= from.top + from.height - .5, above = from.top >= to.top + to.height - .5;
    const right = to.left >= from.left + from.width - .5, left = from.left >= to.left + to.width - .5;
    let start, end, control1, control2, gap, direction;
    if (below || above) {
      direction = below ? 'down' : 'up';
      start = [from.left + from.width / 2, below ? from.top + from.height : from.top];
      end = [to.left + to.width / 2, below ? to.top : to.top + to.height];
      const y = (start[1] + end[1]) / 2;
      control1 = [start[0], y]; control2 = [end[0], y]; gap = below ? end[1] - start[1] : start[1] - end[1];
      if (Math.abs(start[0] - end[0]) < .5) {
        const bow = Math.max(0, Math.min(gap * .25, 12, start[0], width - start[0])) * (start[0] >= width / 2 ? 1 : -1);
        control1[0] += bow; control2[0] += bow;
      }
    } else {
      direction = right ? 'right' : 'left';
      start = [right ? from.left + from.width : from.left, from.top + from.height / 2];
      end = [right ? to.left : to.left + to.width, to.top + to.height / 2];
      const x = (start[0] + end[0]) / 2;
      control1 = [x, start[1]]; control2 = [x, end[1]];
      gap = right ? end[0] - start[0] : left ? start[0] - end[0] : -1;
      if (Math.abs(start[1] - end[1]) < .5) {
        const bow = Math.max(0, Math.min(gap * .2, 10, start[1], height - start[1])) * (right ? 1 : -1);
        control1[1] -= bow; control2[1] += bow;
      }
    }
    const centre = curveMidpoint(start, control1, control2, end);
    return { from: GAME_IDS[i], to: GAME_IDS[i + 1], start, end, control1, control2,
      d: `M ${point(start)} C ${point(control1)} ${point(control2)} ${point(end)}`,
      dot: { x: centre[0], y: centre[1], radius: Math.min(3, Math.max(0, gap) / 3) }, gap, direction };
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
  let pathNodes = [], dotNodes = [];
  const node = (tag, attrs = {}) => {
    const result = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
    return result;
  };
  const attribute = (element, key, value) => {
    const text = String(value);
    if (element.getAttribute(key) !== text) element.setAttribute(key, text);
  };
  function render() {
    frame = null;
    if (destroyed) return;
    const cards = EVENTS.map(index => container.querySelector(`.game-card[data-open="event:${index}"]`));
    if (cards.some(card => !card)) return;
    const progress = gameTimelineState(getState(), { now: now() });
    for (const [i, card] of cards.entries()) {
      const status = progress.steps[i].status;
      if (card.dataset.timelineState !== status) card.dataset.timelineState = status;
      attribute(card, 'aria-description', `Game ${i + 1} of 5. ${({ completed: 'Complete.', active: 'Ongoing game.', next: 'Next up.', upcoming: 'Coming up.' })[status]}`);
    }
    const bounds = container.getBoundingClientRect();
    const width = container.clientWidth || bounds.width, height = container.clientHeight || bounds.height;
    const paths = gameTimelineGeometry(cards.map(card => card.getBoundingClientRect()), { ...bounds,
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, layoutWidth: width, layoutHeight: height });
    if (!paths.length || paths.some(path => path.gap < 0)) { if (svg) svg.style.display = 'none'; return; }
    if (!svg || svg.parentNode !== container) {
      svg = node('svg', { class: 'game-timeline', 'aria-hidden': 'true', focusable: 'false' });
      pathNodes = []; dotNodes = [];
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
    attribute(svg, 'viewBox', `0 0 ${round(width)} ${round(height)}`);
    attribute(svg, 'data-completed', progress.completed);
    for (const [i, geometry] of paths.entries()) {
      const status = progress.segments[i].status;
      if (!pathNodes[i]) {
        const path = node('path', { pathLength: 1, 'data-game-from': geometry.from, 'data-game-to': geometry.to });
        path.style.setProperty('--timeline-order', i);
        const dot = node('circle');
        pathNodes[i] = path; dotNodes[i] = dot;
        svg.append(path); svg.append(dot);
      }
      // Keep attached nodes so geometry/status updates do not restart the
      // initial stroke reveal or the current segment's breathing animation.
      attribute(pathNodes[i], 'd', geometry.d);
      attribute(pathNodes[i], 'class', `game-timeline-link game-timeline-link--${status}`);
      attribute(dotNodes[i], 'cx', round(geometry.dot.x)); attribute(dotNodes[i], 'cy', round(geometry.dot.y));
      attribute(dotNodes[i], 'r', round(geometry.dot.radius));
      attribute(dotNodes[i], 'class', `game-timeline-dot game-timeline-dot--${status}`);
      dotNodes[i].style.display = geometry.dot.radius >= 1 ? '' : 'none';
    }
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
