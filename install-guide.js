export function renderInstallGuide({available=false,installing=false,installed=false,moreOpen=false}={}) {
  return `<div class="install-guide">
    <section class="install-intro" aria-label="OLYMPICS app">
      <img src="assets/icon-192.png" width="48" height="48" alt="">
      <div><strong>OLYMPICS</strong><p>Add it to your home screen for quick access.</p></div>
    </section>
    <div class="install-prompt" ${installed||available||installing?'':'hidden'}>
      <p class="help" id="install-status" role="status" ${installed?'':'hidden'}>Already added. Open OLYMPICS from your home screen.</p>
      <button class="primary" data-install-app ${installed||!available&&!installing?'hidden':''} ${installing?'disabled':''}>${installing?'Opening…':'Install app'}</button>
    </div>
    <div class="install-cards">
      <section class="note-card install-card" aria-labelledby="install-iphone-title"><h3 id="install-iphone-title">iPhone / iPad</h3><ol>
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap <strong>Share → Add to Home Screen</strong>. Scroll down if needed.</li>
        <li>Leave <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
      </ol></section>
      <section class="note-card install-card" aria-labelledby="install-android-title"><h3 id="install-android-title">Android</h3><ol>
        <li>Open this page in <strong>Chrome</strong>.</li>
        <li>Tap <strong>⋮ → Install and create shortcut → Install</strong>.</li>
        <li>Follow the prompt. Some versions say <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
      </ol></section>
    </div>
    <details class="install-browser-help" id="install-browser-help" ${moreOpen?'open':''}><summary>Using another browser?</summary><ul>
      <li><strong>Firefox:</strong> on iPhone, use Share → Add to Home Screen. On Android, look in ⋮ for Install or Add app to Home screen.</li>
      <li><strong>Samsung Internet:</strong> ☰ → Add page to → Home screen.</li>
      <li><strong>No install option?</strong> Open the page in Safari on iPhone or Chrome on Android, outside WhatsApp or Instagram.</li>
    </ul></details>
    <p class="install-offline help">Open the app once online before the event. Live scores need an internet connection.</p>
  </div>`;
}
