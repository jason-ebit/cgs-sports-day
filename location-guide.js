export const LOCATION = Object.freeze({
  venue: '응봉공원 · 다목적구장',
  venueUrl: 'https://naver.me/59lqYcXJ',
  toiletUrl: 'https://naver.me/G6RwJ9lQ',
  entranceImage: 'assets/location/entrance-guide.jpg',
  mapImage: 'assets/location/park-map-guide.jpg'
});

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

export function renderLocationGuide() {
  return `<div class="location-guide">
    <div class="location-intro"><span class="section-label">MEETING POINT</span><p lang="ko">${escapeHTML(LOCATION.venue)}</p></div>
    <nav class="location-links" aria-label="Location links">
      <a href="${escapeHTML(LOCATION.venueUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Meeting point in Naver Maps · opens in a new tab"><span><strong>Meeting point</strong><small>Open Naver Maps</small></span><span aria-hidden="true">↗</span></a>
      <a href="${escapeHTML(LOCATION.toiletUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Toilet in Naver Maps · opens in a new tab"><span><strong>Toilet</strong><small>Open Naver Maps</small></span><span aria-hidden="true">↗</span></a>
    </nav>
    <section class="location-route" aria-labelledby="location-route-title"><h3 id="location-route-title">From the park entrance</h3><ol>
      <li><span>At the entrance, turn right.</span></li>
      <li><span>Go up the stairs, then right.</span></li>
      <li><span>Meet at the second, larger rectangular court (<span lang="ko">다목적구장</span>).</span></li>
    </ol></section>
    <div class="location-visuals">
      <figure class="location-figure"><figcaption><span class="location-figure-label">1 · Entrance</span><span>Turn right along the path.</span></figcaption><a class="location-image-link" href="${escapeHTML(LOCATION.entranceImage)}" target="_blank" rel="noopener noreferrer" aria-label="Open entrance photo at full size · opens in a new tab"><img src="${escapeHTML(LOCATION.entranceImage)}" alt="Park entrance with an arrow pointing right along the path." decoding="async"><span class="location-image-expand" aria-hidden="true">View larger ↗</span></a></figure>
      <figure class="location-figure location-figure-map"><figcaption><span class="location-figure-label">2 · Park map</span><span>Right → up the stairs → right to the larger court.</span></figcaption><a class="location-image-link" href="${escapeHTML(LOCATION.mapImage)}" target="_blank" rel="noopener noreferrer" aria-label="Open park route map at full size · opens in a new tab"><img src="${escapeHTML(LOCATION.mapImage)}" alt="Eunbong Park guide map showing the route from the entrance to the second, larger rectangular multipurpose court." decoding="async"><span class="location-image-expand" aria-hidden="true">View larger ↗</span></a></figure>
    </div>
  </div>`;
}
