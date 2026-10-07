function connectionDisplay(status = {}) {
  const pending = Math.max(0, Number(status.pending) || 0);
  const pendingDetail = pending ? ` ${pending} update${pending === 1 ? '' : 's'} pending on this phone.` : '';
  if (status.phase === 'conflict' || status.storageError) {
    return { label: 'Review', tone: 'attention', detail: status.storageError
      ? 'Phone storage needs attention. Results are not confirmed.'
      : 'Pending results need review before scoring can continue.' };
  }
  if (!status.connected) {
    const connecting = status.phase === 'connecting';
    return { label: connecting ? 'Connecting' : 'Offline', tone: 'offline', detail: connecting
      ? 'Connecting to shared scores.' : `Showing the last available scores.${pendingDetail}` };
  }
  if (pending || status.phase === 'pending' || status.phase === 'syncing') {
    return { label: status.phase === 'syncing' ? 'Syncing' : 'Pending', tone: 'attention',
      detail: `Results are waiting for shared confirmation.${pendingDetail}` };
  }
  if (status.remoteAvailable === false || status.phase === 'connecting') {
    return { label: 'Connecting', tone: 'offline', detail: 'Waiting for confirmed shared scores.' };
  }
  return { label: 'Live', tone: 'live', detail: status.role === 'writer'
    ? 'Scorekeeper results are synced to shared scores.' : 'Watching confirmed shared scores.' };
}

// Update only the compact badge; login forms and scoring controls stay in place.
export function renderLiveConnection(element, status) {
  if (!element) return;
  const display = connectionDisplay(status);
  element.classList.add('connection-badge');
  element.dataset.connectionTone = display.tone;
  let light = element.querySelector('.connection-light');
  if (!light) {
    light = element.ownerDocument.createElement('span');
    light.className = 'connection-light';
    light.setAttribute('aria-hidden', 'true');
    element.prepend(light);
  }
  let label = element.querySelector('#sync-label') || element.querySelector('[data-connection-label]');
  if (!label) {
    label = element.ownerDocument.createElement('span');
    label.dataset.connectionLabel = '';
    element.append(label);
  }
  label.textContent = display.label;
  element.title = display.detail;
  element.setAttribute('aria-label', `Live scores. ${display.detail} Open scorekeeper controls.`);
}
