import { GAME_EVENTS, GAME_NAMES } from './content.js?v=63';
import { TEAM_IDS } from './model.js?v=63';

// These are the existing match presets. Duty windows are only a plan; starting
// or changing a match clock never starts or changes a separate rota timer.
const BORROW_SECONDS = [90, 90, 120, 120, 120, 120, 90];
const RELAY_SECONDS = [480, 600, 480];
const TUG_MATCHES = ['prelim', 'semi1', 'semi2', 'final'];
const TUG_LABELS = ['Preliminary', 'Semifinal 1', 'Semifinal 2', 'Final'];
const RELAY_LABELS = ['Baton', 'Three-legged', 'Spoon & ball'];
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function clockSeconds(state, key, fallback) {
  const duration = state?.timers?.[key]?.duration;
  return Number.isInteger(duration) && duration > 0 && duration <= 86400000 ? duration / 1000 : fallback;
}

function blocksFor(state, game) {
  if (game === 'borrow') {
    const count = state?.borrow?.rounds === 7 ? 7 : 6;
    return Array.from({ length: Math.ceil(count / 2) }, (_, index) => {
      const first = index * 2, last = Math.min(first + 1, count - 1);
      const keys = Array.from({ length: last - first + 1 }, (_, offset) => `borrow:${first + offset}`);
      return { groupKey: `borrow:pair:${index}`, keys,
        label: first === last ? `Round ${first + 1} · Same-card race` : `Rounds ${first + 1}–${last + 1}`,
        minimumSeconds: keys.reduce((sum, key, offset) => sum + clockSeconds(state, key, BORROW_SECONDS[first + offset]), 0) + (keys.length - 1) * 60,
        swapSeconds: 60,
        note: 'Keep the same crew for both rounds. Check each player’s team before they join.' };
    });
  }
  if (game === 'basket') return TEAM_IDS.map(id => ({
    groupKey: `basket:${id}`, keys: [0, 1].map(attempt => `basket:${id}:${attempt}`),
    label: `${state?.teams?.find(team => team.id === id)?.name || id[0].toUpperCase() + id.slice(1)} · both tries`,
    minimumSeconds: [0, 1].reduce((sum, attempt) => sum + clockSeconds(state, `basket:${id}:${attempt}`, 30), 0) + 60,
    swapSeconds: 90,
    note: 'Keep the same crew for both tries. The active team’s volunteers need cover.',
  }));
  if (game === 'cavalry') return ['women', 'men'].map(division => ({
    groupKey: `cavalry:${division}`, keys: [`cavalry:${division}`], label: division === 'women' ? 'Women’s round' : 'Men’s round',
    minimumSeconds: clockSeconds(state, `cavalry:${division}`, state?.cavalry?.cap || 300), swapSeconds: 90,
    note: 'Check each player’s division and team. Swap only after the arena is clear.',
  }));
  if (game === 'tug') return TUG_MATCHES.map((match, index) => ({
    groupKey: `tug:${match}`, keys: [`tug:${match}`], label: TUG_LABELS[index],
    minimumSeconds: clockSeconds(state, `tug:${match}`, 60), swapSeconds: 90,
    note: 'Swap after the pull ends. Use helpers from teams that are resting.',
  }));
  if (game === 'relay') return RELAY_SECONDS.map((seconds, index) => ({
    groupKey: `relay:${index}`, keys: [`relay:${index}`], label: RELAY_LABELS[index],
    minimumSeconds: clockSeconds(state, `relay:${index}`, seconds), swapSeconds: 90,
    note: 'Hand over before the next race. Check each player’s team and keep team sizes equal.',
  }));
  return [];
}

function timeSeconds(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 3600 + minute * 60;
}

function timeLabel(seconds) {
  const whole = Math.round(seconds);
  const hour = String(Math.floor(whole / 3600)).padStart(2, '0');
  const minute = String(Math.floor(whole % 3600 / 60)).padStart(2, '0');
  const second = whole % 60;
  return `${hour}:${minute}${second ? `:${String(second).padStart(2, '0')}` : ''}`;
}

function plannedWindows(blocks, event) {
  const start = timeSeconds(event?.start), end = timeSeconds(event?.end);
  if (start === null || end === null || end <= start) return { reason: 'no-schedule', windows: [] };
  // Reserve one minute at the start for instructions. Paired rounds/tries also
  // retain a minute between them to reset equipment and confirm the result.
  const handovers = blocks.slice(0, -1).reduce((sum, block) => sum + block.swapSeconds, 0);
  const minimum = 60 + handovers + blocks.reduce((sum, block) => sum + block.minimumSeconds, 0);
  if (minimum > end - start) return { reason: 'limits-too-long', windows: [] };
  const slack = end - start - minimum;
  // Keep normal timetable boundaries on half minutes. The last window takes
  // the remainder, so all handovers stay inside the original event allocation.
  const share = Math.floor(slack / blocks.length / 30) * 30;
  let cursor = start + 60;
  const windows = blocks.map((block, index) => {
    const duration = block.minimumSeconds + share + (index === blocks.length - 1 ? slack - share * blocks.length : 0);
    const window = { start: timeLabel(cursor), end: timeLabel(cursor + duration) };
    cursor += duration + (index < blocks.length - 1 ? block.swapSeconds : 0);
    return window;
  });
  return { reason: null, windows };
}

/** A planned duty block, not a predicted live finish or a new scoring round.
 * handoverSeconds is the gap AFTER this block, and is zero for the last one.
 * schedule can be the existing array or its enclosing event-details object.
 */
export function rotationInterval(state, key, schedule) {
  if (typeof key !== 'string') return null;
  const game = key.split(':')[0], blocks = blocksFor(state, game);
  const index = blocks.findIndex(block => block.keys.includes(key));
  if (index < 0) return null;
  const entries = Array.isArray(schedule) ? schedule : schedule?.schedule;
  const event = Array.isArray(entries) ? entries.find(item => item?.title === GAME_NAMES[game]) || entries[GAME_EVENTS[game]] : null;
  const { reason, windows } = plannedWindows(blocks, event);
  const block = blocks[index];
  return { label: block.label, handoverSeconds: index < blocks.length - 1 ? block.swapSeconds : 0,
    groupKey: block.groupKey, start: windows[index]?.start || null, end: windows[index]?.end || null,
    note: block.keys.length === 1 && game === 'borrow' ? 'Give every team the same card. Start together; confirm the duty crew before the race.' : block.note,
    reason };
}

/** Compact, read-only timing guidance beside the existing rota controls. */
export function renderRotationInterval(state, key, schedule) {
  const interval = rotationInterval(state, key, schedule);
  if (!interval) return '';
  const timing = interval.start ? `Planned ${interval.start}–${interval.end}` : 'Planned duty block';
  const handover = interval.handoverSeconds ? `${interval.handoverSeconds} sec handover after this block.` : 'Hand over when the game ends.';
  const review = interval.reason === 'limits-too-long' ? '<p class="rota-interval-review">Timer limits do not fit the planned slot. Check the timing before play.</p>' : '';
  return `<aside class="rota-interval" aria-label="Planned duty interval"><div class="rota-interval-heading"><strong>${escapeHTML(interval.label)}</strong><span>${escapeHTML(timing)}</span></div><p class="rota-interval-handover">${handover}</p>${review}<ul><li>${escapeHTML(interval.note)}</li></ul></aside>`;
}
