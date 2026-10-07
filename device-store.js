import { defaultState, validateState } from './model.js?v=26';

export function createDeviceStore({ key = 'cg-sports-day-v1', getStorage = () => globalThis.localStorage } = {}) {
  let state = defaultState(), saved = false, protectedSave = false, unreadableRaw = null;
  try {
    const raw = getStorage().getItem(key);
    if (raw !== null) {
      unreadableRaw = raw;
      state = validateState(JSON.parse(raw));
      unreadableRaw = null;
    }
    saved = true;
  } catch {
    // Keep failed reads intact until reset or import explicitly replaces them.
    protectedSave = true;
  }

  function save(nextState = state) {
    state = nextState;
    if (protectedSave) return false;
    try {
      getStorage().setItem(key, JSON.stringify(state));
      saved = true;
      return true;
    } catch {
      saved = false;
      return false;
    }
  }

  function backup(currentState = state) {
    if (protectedSave) {
      if (unreadableRaw === null) {
        try {
          unreadableRaw = getStorage().getItem(key);
        } catch {
          throw Error('Saved data is unavailable. Try downloading the backup again when storage is accessible.');
        }
      }
      if (unreadableRaw !== null) return unreadableRaw;
    }
    return JSON.stringify(currentState, null, 2);
  }

  function replace(nextState) {
    protectedSave = false;
    unreadableRaw = null;
    return save(nextState);
  }

  return {
    get state() { return state; },
    get saved() { return saved; },
    get protected() { return protectedSave; },
    save, backup, replace,
  };
}
