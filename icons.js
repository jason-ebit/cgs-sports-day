const paths = {
 clock: '<circle cx="24" cy="24" r="22" fill="currentColor" stroke="none"/><circle cx="24" cy="24" r="14" fill="white" stroke="none"/><path d="M24 15v10h8" stroke-width="3.5"/>',
 calendar: '<rect x="8" y="10" width="33" height="33" rx="3" stroke-width="4"/><path d="M8 20h33M16 5v10M33 5v10" stroke-width="4"/><path d="M16 26h3m6 0h3m6 0h1M16 34h3m6 0h3m6 0h1" stroke-width="4"/>',
 pin: '<path d="M24 45S9 29 9 19a15 15 0 0 1 30 0c0 10-15 26-15 26Z" fill="currentColor" stroke="none"/><circle cx="24" cy="19" r="5.5" fill="white" stroke="none"/>',
 setup: '<path d="m20 4-1 6-5 2-5-3-5 8 5 4v6l-5 4 5 8 6-3 5 3 1 6h9l1-6 5-3 5 3 5-8-5-4v-6l5-4-5-8-6 3-5-2-1-6Z" transform="translate(-2 -1) scale(.98)" fill="currentColor" stroke="none"/><circle cx="23" cy="23" r="8" fill="white" stroke="none"/>',
 people: '<circle cx="18" cy="13" r="7" fill="currentColor" stroke="none"/><circle cx="34" cy="13" r="6" fill="currentColor" stroke="none"/><path d="M5 41V29a13 13 0 0 1 26 0v12ZM33 24c9-4 13 3 13 9v8H34Z" fill="currentColor" stroke="none"/>',
 flag: '<path d="M11 44V5" stroke-width="4"/><path d="M14 7c8-5 12 6 23 0v20c-11 6-16-5-23 0Z" fill="currentColor" stroke="none"/>',
 warmup: '<path d="M4 24h40M8 15v18M15 10v28M33 10v28M40 15v18" stroke-width="5"/>',
 borrow: '<circle cx="20" cy="19" r="13" stroke-width="4"/><path d="m30 30 13 14" stroke-width="6"/>',
 basket: '<path d="M5 19h38l-6 25H11ZM3 19h42M17 5 7 15M31 5l10 10M9 28h31M12 36h26M18 20l2 23M30 20l-2 23" stroke-width="3.5"/>',
 break: '<path d="M9 5v14q0 7 6 7V44M15 5v17M21 5v14q0 7-6 7M35 44V5q-8 1-8 18h8" stroke-width="4"/>',
 cavalry: '<path d="m8 43 5-15 2-13 13-8 4-6 1 10 8 9 2 8-7 3-10-8 1 12 5 9Z" fill="currentColor" stroke="none"/><path d="m12 27-6 6 5-18L23 7" stroke-width="3"/><circle cx="30" cy="16" r="1.5" fill="white" stroke="none"/>',
 tug: '<path d="M19 28C0 49-7 24 12 22l6 3M29 21C49 0 55 25 36 26l-6-3" stroke-width="5"/><path d="m18 29 13-10M16 23l7 10M20 19l8 11M25 17l8 9" stroke-width="3"/><path d="M15 27C2 39 2 26 13 26M33 20c14-12 14 1 2 2" stroke-width="1"/>',
 relay: '<path d="m9 40-3-3q-2-2 0-5L31 5q3-3 6 0l6 5q3 3 0 6L17 42q-3 3-6 0Z" stroke-width="3"/><path d="m6 32 10 10 10-10-10-10Z" fill="currentColor" stroke="none"/>',
 buffer: '<path d="M10 5h28M10 43h28M13 5c0 15 11 14 11 19S13 29 13 43M35 5c0 15-11 14-11 19s11 5 11 19" stroke-width="3.5"/><path d="m16 11 8 8 8-8M17 39l7-9 7 9" fill="currentColor" stroke="none"/>',
 trophy: '<path d="M14 5h22v12q0 14-11 14T14 17ZM25 31v10M15 44h20M13 9H5v9q0 10 13 10M36 9h7v9q0 10-12 10" stroke-width="3.5"/><path d="M17 8h15v13q0 7-7 7t-8-7Z" fill="currentColor" stroke="none"/>',
 camera: '<path d="M6 13h9l4-6h12l4 6h7v29H6Z" fill="currentColor" stroke="none"/><circle cx="25" cy="27" r="10" stroke="white" stroke-width="2"/><circle cx="25" cy="27" r="6" stroke="white" stroke-width="1"/>',
 cleanup: '<path d="m28 24 13-20" stroke-width="5"/><path d="m23 22 9 6-3 8-14-9ZM13 28l16 10-5 9-5-3 3-6-6 4-5-3 4-6-7 4-5-3Z" fill="currentColor" stroke="none"/>',
 finish: '<path d="M7 45 11 5M13 7h31l-4 26H10" stroke-width="3"/><path d="m14 7-1 8h8l1-8h8l-1 8h8l1-8h6l-1 8h-6l-1 9h6l-2 9h-6l1-9h-8l-1 9h-8l1-9h-8l1-9h8l-1 9h8l1-9h-8l1-8Z" fill="currentColor" stroke="none"/>',
};
export function icon(name) { return `<svg class="icon" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.flag}</svg>`; }
export function iconData(name) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(icon(name).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor','#111111')); }
