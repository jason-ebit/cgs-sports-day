export const VIEWING_URL = 'https://jason-ebit.github.io/cgs-sports-day/';

export function renderViewingShare() {
  return `<section class="viewing-share" aria-labelledby="viewing-share-title">
    <img class="viewing-qr" src="assets/share/live-qr.svg" width="176" height="176" alt="QR code to open the Sports Day live page">
    <div class="viewing-share-details">
      <h3 id="viewing-share-title">Open on your phone</h3>
      <p>Scan for the rundown and live scores.</p>
      <label class="field">Live page<input id="viewing-link" type="url" value="${VIEWING_URL}" readonly spellcheck="false"></label>
      <div class="button-row">
        <button class="primary" data-action="copy-viewing-link">Copy link</button>
        <a class="secondary" href="assets/share/live-qr.png" download="cg-sports-day-qr.png">Download QR</a>
      </div>
    </div>
  </section>`;
}
