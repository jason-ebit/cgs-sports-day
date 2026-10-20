import { LOCATION } from './location-guide.js?v=51';
import { orderedSchedule, scheduleBounds } from './content.js?v=51';

export function googleCalendarLink(event) {
  const {start,end}=scheduleBounds(event.schedule);
  // Korea's explicit UTC offset keeps the event time independent of the viewer's device.
  const timestamp=time=>new Date(`${event.date}T${time}:00+09:00`).toISOString().replace(/[-:]|\.\d{3}/g,'');
  const details=[
    orderedSchedule(event.schedule).slice(0,3).map(item=>`${item.title}: ${item.start}–${item.end}.`).join(' '),
    'Meet at the second, larger court (다목적구장). From the park entrance: right, up the stairs, then right.',
    `Directions: ${LOCATION.venueUrl}`,
    `Toilet: ${LOCATION.toiletUrl}`,
    'Rundown & live scores: https://jason-ebit.github.io/cgs-sports-day/'
  ].join('\n\n');
  const url=new URL('https://calendar.google.com/calendar/r/eventedit');
  url.search=new URLSearchParams({
    action:'TEMPLATE',
    text:event.title,
    dates:`${timestamp(start)}/${timestamp(end)}`,
    stz:event.timezone,
    etz:event.timezone,
    details,
    location:event.venue
  }).toString();
  return url.href;
}
