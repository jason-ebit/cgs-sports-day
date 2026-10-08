import { LOCATION } from './location-guide.js?v=31';

export function googleCalendarLink(event) {
  const times=event.schedule.flatMap(item=>[item.start,item.end]).filter(Boolean).sort();
  // Korea's explicit UTC offset keeps the event time independent of the viewer's device.
  const timestamp=time=>new Date(`${event.date}T${time}:00+09:00`).toISOString().replace(/[-:]|\.\d{3}/g,'');
  const details=[
    'Committee setup: 11:40. Participant program: 12:00–16:00.',
    'Meet at the second, larger court (다목적구장). From the park entrance: right, up the stairs, then right.',
    `Directions: ${LOCATION.venueUrl}`,
    `Toilet: ${LOCATION.toiletUrl}`,
    'Rundown & live scores: https://jason-ebit.github.io/cgs-sports-day/'
  ].join('\n\n');
  const url=new URL('https://calendar.google.com/calendar/r/eventedit');
  url.search=new URLSearchParams({
    action:'TEMPLATE',
    text:event.title,
    dates:`${timestamp(times[0])}/${timestamp(times.at(-1))}`,
    stz:event.timezone,
    etz:event.timezone,
    details,
    location:event.venue
  }).toString();
  return url.href;
}
