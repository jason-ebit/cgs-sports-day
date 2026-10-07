function connectionDisplay(status = {}) {
  const pending = Math.max(0, Number(status.pending) || 0);
  const pendingDetail = pending ? ` · ${pending} pending` : '';
  if (status.phase === 'conflict' || status.storageError) {
    return { label: 'Review', tone: 'attention', detail: status.storageError
      ? 'Review storage' : 'Review pending' };
  }
  if (!status.connected) {
    const connecting = status.phase === 'connecting';
    return { label: connecting ? 'Connecting' : 'Offline', tone: 'offline', detail: connecting
      ? 'Connecting' : `Offline${pendingDetail}` };
  }
  if (pending || status.phase === 'pending' || status.phase === 'syncing') {
    return { label: status.phase === 'syncing' ? 'Syncing' : 'Pending', tone: 'attention',
      detail: status.phase === 'syncing' ? `Syncing${pendingDetail}` : pending ? `${pending} pending` : 'Pending' };
  }
  if (status.remoteAvailable === false || status.phase === 'connecting') {
    return { label: 'Connecting', tone: 'offline', detail: 'Connecting' };
  }
  return { label: 'Live', tone: 'live', detail: 'Live · Synced' };
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
  element.title = `${display.detail}. Scorekeeper only.`;
  element.setAttribute('aria-label', element.title);
}
