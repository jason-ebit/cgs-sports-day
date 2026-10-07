import assert from 'node:assert/strict';
import { captureView } from '../view-state.js';

// Model the browser operations used by captureView, including replacement nodes.
class Element {
  constructor(tagName = 'div', properties = {}, children = []) {
    this.tagName = tagName.toUpperCase();
    this.id = ''; this.name = ''; this.type = 'text'; this.dataset = {};
    this.classList = []; this.children = []; this.scrollTop = 0; this.scrollLeft = 0;
    this.open = false; this.disabled = false; this.value = ''; this.defaultValue = '';
    this.selectionStart = null; this.selectionEnd = null; this.selectionDirection = 'none';
    this.focusCalls = []; this.selectionCalls = [];
    Object.assign(this, properties);
    this.replace(children);
  }
  get attributes() {
    return Object.entries(this.dataset).map(([key, value]) => ({
      name: 'data-' + key.replace(/[A-Z]/g, character => '-' + character.toLowerCase()), value: String(value)
    }));
  }
  attach(document) {
    this.ownerDocument = document;
    for (const child of this.children) child.attach(document);
  }
  replace(children) {
    this.children = children;
    for (const child of children) {
      child.parentElement = this;
      if (this.ownerDocument) child.attach(this.ownerDocument);
    }
  }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  matches(selector) {
    if (selector === '[id]') return Boolean(this.id);
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const [, className] of selector.matchAll(/\.([\w-]+)/g)) {
      if (!this.classList.includes(className)) return false;
    }
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this[name];
      if (actual === undefined || value !== undefined && String(actual) !== value) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const elements = [];
    for (const child of this.children) {
      if (child.matches(selector)) elements.push(child);
      elements.push(...child.querySelectorAll(selector));
    }
    return elements;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus(options) { this.focusCalls.push(options); this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction) {
    if (this.type === 'number') throw new Error('Selection is unsupported for number inputs');
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    this.selectionCalls.push({start, end, direction});
  }
}

const document = {activeElement: null};
globalThis.document = document;
globalThis.CSS = {escape: value => String(value)};
const tests = [];
function test(name, run) {
  document.activeElement = null;
  try { run(); tests.push({name, pass: true}); }
  catch (error) { tests.push({name, pass: false, error: error.stack}); }
}
function root(children, properties = {}) {
  const element = new Element('dialog', {id: 'detail-dialog', ...properties}, children);
  element.attach(document);
  return element;
}
function input(value, baseline, properties = {}) {
  return new Element('input', {
    value, defaultValue: baseline, dataset: {liveScore: '', committedValue: baseline}, ...properties
  });
}
function liveKey(key) { return new Element('section', {dataset: {liveKey: key}}); }

test('A refresh keeps an unfinished input draft and its selection when the saved score is unchanged', () => {
  const field = input('', '4', {selectionStart: 0, selectionEnd: 0, selectionDirection: 'forward'});
  const dialog = root([liveKey('basket:red:0'), field]); document.activeElement = field;
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('4', '4'); dialog.replace([liveKey('basket:red:0'), replacement]);
  restore('event:5/timer');
  assert.equal(replacement.value, '');
  assert.deepEqual(replacement.focusCalls, [{preventScroll: true}]);
  assert.deepEqual(replacement.selectionCalls, [{start: 0, end: 0, direction: 'forward'}]);
});

test('A genuine remote score replaces a draft while the same field keeps focus', () => {
  const field = input('unfinished', '4', {selectionStart: 3, selectionEnd: 8});
  const dialog = root([liveKey('basket:red:0'), field]); document.activeElement = field;
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('9', '9'); dialog.replace([liveKey('basket:red:0'), replacement]);
  restore('event:5/timer');
  assert.equal(replacement.value, '9');
  assert.equal(document.activeElement, replacement, 'The changing committed value is not part of the field identity.');
  assert.deepEqual(replacement.selectionCalls, []);
});

test('A newer local committed baseline preserves the next unfinished edit', () => {
  const field = input('Jason ', 'Red');
  field.dataset.committedValue = 'Jason';
  const dialog = root([field]); document.activeElement = field;
  const restore = captureView(dialog, 'teams/timer');
  const replacement = input('Jason', 'Jason'); dialog.replace([replacement]); restore('teams/timer');
  assert.equal(replacement.value, 'Jason ');
});

test('A textarea keeps multiline drafts and backwards selection using its default value baseline', () => {
  const field = new Element('textarea', {dataset: {committeeNote: 'first-aid', noteKey: 'general'},
    defaultValue: 'Check kit', value: 'Check kit\nAsk about asthma', selectionStart: 10, selectionEnd: 24, selectionDirection: 'backward'});
  const dialog = root([field]); document.activeElement = field;
  const restore = captureView(dialog, 'committee/first-aid');
  const replacement = new Element('textarea', {dataset: {...field.dataset}, defaultValue: 'Check kit', value: 'Check kit'});
  dialog.replace([replacement]); restore('committee/first-aid');
  assert.equal(replacement.value, field.value);
  assert.deepEqual(replacement.selectionCalls, [{start: 10, end: 24, direction: 'backward'}]);
});

test('A changed textarea baseline keeps the newly committed note', () => {
  const field = new Element('textarea', {name: 'reminder', value: 'Local draft', defaultValue: 'Original note'});
  const dialog = root([field]); document.activeElement = field;
  const restore = captureView(dialog, 'committee/director');
  const replacement = new Element('textarea', {name: 'reminder', value: 'Updated note', defaultValue: 'Updated note'});
  dialog.replace([replacement]); restore('committee/director');
  assert.equal(replacement.value, 'Updated note'); assert.equal(replacement.focusCalls.length, 1);
});

for (const [name, nextPanel, nextRound] of [
  ['Changing the panel', 'event:5/scores', 'basket:red:0'],
  ['Changing the round', 'event:5/timer', 'basket:red:1']
]) test(`${name} does not carry a draft, focus, settings or scroll into the new view`, () => {
  const field = input('', '4');
  const settings = new Element('details', {classList: ['clock-options'], open: true});
  const dialog = root([liveKey('basket:red:0'), settings, field], {scrollTop: 80}); document.activeElement = field;
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('4', '4'), nextSettings = new Element('details', {classList: ['clock-options']});
  dialog.replace([liveKey(nextRound), nextSettings, replacement]); dialog.scrollTop = 0;
  restore(nextPanel);
  assert.equal(replacement.value, '4'); assert.deepEqual(replacement.focusCalls, []);
  assert.equal(nextSettings.open, false); assert.equal(dialog.scrollTop, 0);
});

test('Anonymous score, bracket, department, tab and round containers keep their horizontal positions', () => {
  const classes = ['score-table-wrap', 'score-table-wrap', 'bracket-scroll', 'committee-tabs', 'detail-tabs', 'round-strip'];
  const containers = classes.map((className, index) => new Element('div', {
    classList: [className, 'old-decoration'], scrollLeft: 30 + index * 19, scrollTop: index * 7
  }));
  const dialog = root(containers, {scrollTop: 113, scrollLeft: 3});
  const restore = captureView(dialog, 'event:8/play');
  const replacements = classes.map(className => new Element('div', {classList: [className]}));
  dialog.replace(replacements); dialog.scrollTop = 0; dialog.scrollLeft = 0;
  restore('event:8/play');
  assert.equal(dialog.scrollTop, 113); assert.equal(dialog.scrollLeft, 3);
  replacements.forEach((element, index) => {
    assert.equal(element.scrollLeft, 30 + index * 19); assert.equal(element.scrollTop, index * 7);
  });
});

test('Open and closed settings, summary focus and identified body scrolling survive a refresh', () => {
  const summary = new Element('summary');
  const opened = new Element('details', {classList: ['draw-settings'], open: true}, [summary]);
  const closed = new Element('details', {classList: ['clock-options'], open: false});
  const body = new Element('div', {id: 'detail-body', scrollTop: 240}, [opened, closed]);
  const dialog = root([body]); document.activeElement = summary;
  const restore = captureView(dialog, 'event:8/play');
  const nextSummary = new Element('summary');
  const nextOpened = new Element('details', {classList: ['draw-settings']}, [nextSummary]);
  const nextClosed = new Element('details', {classList: ['clock-options'], open: true});
  const nextBody = new Element('div', {id: 'detail-body'}, [nextOpened, nextClosed]);
  dialog.replace([nextBody]); restore('event:8/play');
  assert.equal(nextOpened.open, true); assert.equal(nextClosed.open, false);
  assert.equal(nextBody.scrollTop, 240); assert.equal(document.activeElement, nextSummary);
});

test('Unsupported number selection is harmless and a number draft still survives', () => {
  const field = input('', '7', {type: 'number', selectionStart: 0, selectionEnd: 0});
  const dialog = root([field]); document.activeElement = field;
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('7', '7', {type: 'number'}); dialog.replace([replacement]);
  assert.doesNotThrow(() => restore('event:5/timer'));
  assert.equal(replacement.value, ''); assert.equal(document.activeElement, replacement);
});

test('A newly locked field is not refocused or overwritten with a draft', () => {
  const field = input('', '7'); const dialog = root([field]); document.activeElement = field;
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('7', '7', {disabled: true}); dialog.replace([replacement]); restore('event:5/timer');
  assert.equal(replacement.value, '7'); assert.deepEqual(replacement.focusCalls, []);
});

test('An active element outside the panel never pulls focus into the refreshed panel', () => {
  const field = input('7', '7'); const dialog = root([field]); document.activeElement = input('outside', 'outside');
  const restore = captureView(dialog, 'event:5/timer');
  const replacement = input('7', '7'); dialog.replace([replacement]); restore('event:5/timer');
  assert.deepEqual(replacement.focusCalls, []);
});

for (const result of tests) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.error ? '\n' + result.error : ''}`);
if (tests.some(result => !result.pass)) process.exitCode = 1;
