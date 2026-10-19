# OLYMPICS

## Use on a phone

The published site is installable and keeps its app shell available offline after the first successful visit. On iPhone, open the GitHub Pages URL in Safari, choose **Share → Add to Home Screen**, and open it once while online. On Android, open the URL in Chrome and choose **Install app** or **Add to Home screen**.

Shared scores, brackets, timers and committee names use Supabase. Everyone watches the same GitHub Pages link; one registered scorekeeper signs in through the status indicator in the top bar. Its panel is marked **Scorekeeper only**. A green blinking ● Live appears only while connected with confirmed scores; Pending / Review and Offline remain distinct. Committee reminders, leaders and headcounts stay in the browser on that phone. Use **Reset / backup → Download JSON backup** to safeguard device data.

Updates install as a complete offline version and take effect on the next page load. They never reload a running timer. If an update download fails, the installed version remains available.

Working responsive rundown and game desk, built from `reference.png`, `PROJECT_BRIEF.md` and the approved `schedule.json`. Date: **October 25, 2026**, confirmed by the user. The compact card keeps **OCT 25**. Venue: **응봉공원 · 다목적구장**.

## Run

No package installation is needed. The pinned Supabase browser client is bundled locally. `sync-config.js` contains only the public project URL and publishable key. From this folder:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open **http://127.0.0.1:4173** to watch shared scores, or **http://127.0.0.1:4173/?local** for an isolated editable preview. Keep the terminal running. Serve over HTTP; double-clicking `index.html` will not load the JavaScript modules / schedule reliably. The live app is at https://jason-ebit.github.io/cgs-sports-day/.

## Use

- **Home:** the landing page uses a wide, screen-filling grid with readable type, aligned cards and muted sage / gold / rose accents. Phones have a **Rundown / Games** switch so each view fits without shrinking the entire poster. **Expand layout** offers the roomier scrollable version. Small rounded game tiles follow an S route: Borrow → Basket → Cavalry on the right → Tug on the left → Relay below. A running or paused game stays highlighted with its matchup and timer; completed steps stay marked and the current step breathes. Full round details are inside each game.
- **Location:** a separate card beside the date opens venue and toilet links in Naver Maps, concise walking steps, the annotated entrance photo and park route map. Tap an image to view it larger. Guide images are cached with the app for offline use. The separate staircase photo remains to be supplied; both uploaded HEIC files were identical. Image editing used the built-in image generator; the assets and exact prompts are in `assets/location/`.
- **Calendar:** tap the blue **Add to calendar** date card (**Add** on phones) to review and save a pre-filled OLYMPICS Google Calendar event for October 25, 2026, 11:00–16:18 in Korea time. It includes the venue, walking directions, toilet link and live site; the description includes setup, CG-IN and registration times.
- **Game desk:** games open on **Timer & scoring**, with numbered rounds/attempts above the controls. Round selection stays shared across Timer, Scores, Format and Committee tabs. Team choices are rounded colour buttons. A single Play / Pause / Next action stays visible on phones while results scroll. Next names its destination and skips finished work, including missing earlier rounds.
- **Follow live:** spectators follow the active round or match within the selected game. Choosing a round or team enters Review; **Follow live** resumes following. Spectator desks show timers and results without scoring inputs, timer settings or reset menus. The in-game connection label updates without rebuilding input fields.
- **Back:** linked panels return to their previous tab, department, round/attempt, focus and scroll position. Updates preserve unfinished input drafts when the underlying saved value is unchanged; genuine shared changes take precedence.
- **Undo:** Borrow, Relay and Cavalry offer one session-only Undo for the last accepted result while its round is unfinished. It preserves the clock and checks that no later result or reset has replaced that tap. Completed rounds stay locked; corrections then use the existing scoped reset.
- **Rundown:** Committee Setup runs 11:00–11:40, then CG-IN 11:40–12:20, before Registration / Team Draw 12:20–12:35. Later slots keep their durations and run consecutively through Finish at 16:18. The date card, calendar and exports use the schedule’s start and finish. The rundown and poster exports show the new slot in chronological order; existing saved event notes and timers keep their original identities.
- **Borrow-a-Thing:** tap **Success** in arrival order: 5 / 4 / 3 / 2 / 2. **Fail** awards zero and does not consume a success rank. Every team recorded completes and locks the round. Six rounds by default; the Scores tab can include the seventh contingency round.
- **Ball Basket:** select a team and attempt, count with + / − or enter the count, then **Finish attempt & lock**. Valid counts save while typing, including before timer expiry. The higher of two counts determines game placing.
- **Cavalry:** rounds 1 and 2 retain the existing women’s and men’s divisions. Select arena teams directly, press Play, then tap **Horse out** in elimination order while the timer runs. Last survivor gets 5, then 4 / 3 / 2 / 1 in reverse elimination order; teams outside that round receive 0. Both rounds are added, then converted to championship placing. The five-minute starting timer is adjustable; it is an operational preset, not a confirmed event rule. Eligibility forms and manual scoring approval are removed.
- **Tug-of-War:** use random draw, unique seeds, or colour buttons for manual slots. Duplicate assignment swaps teams. Lock the draw, then run matches; selecting a winner saves and advances the bracket, ending and locking that match. Resetting an earlier match also clears dependent results and timers. The final awards championship points automatically; semifinal losers share third place.
- **Team Relay:** tap each team’s **Finish** in arrival order. Places convert to 5 / 4 / 3 / 2 / 1 points. Completing all five results locks the round.
- **Timer:** play/pause, +30 seconds, editable limits, optional end sound, timer-only reset and 30-second tug rematch. Every round, match and attempt requires Play before results can be entered. Pausing keeps scoring available; resetting the timer requires Play again. One timer runs at a time; starting another pauses the previous one. Saved deadlines keep elapsed time accurate across tabs, popups and reloads. Background audio depends on browser support; this is not a system alarm.
- **Big screen:** overlays the game popup and returns to it when closed. Tap controls normally; hold and drag anywhere on either timer to move it. Drop onto the red circular X to hide it. Arrow keys move a focused timer popup without affecting its inputs. Hiding either popup keeps the timer running. All views use the same clock and results.
- **Committee:** department tabs for Judge / scores, Assistant judge, First aid, Equipment, Food & water, Comm, Warm-up and Team leaders. Each has a compact roster above essential duty bullets: 1 main judge / scorer, 1 assistant judge, 2 first aid, 3 equipment, 2 food/water plus 1 optional helper, 2 Comm, 1 warm-up lead and 5 team leaders. The scorekeeper edits names directly in the roster; each edit saves automatically and syncs to viewers. Comm starts with Cindy and Mario and covers photos / videos only; empty slots show TBA. The warm-up lead runs a five-minute session, mostly light stretching. Support cover is 10–11, or 12–13 including both judges; team leaders are separate. Duties use plain lists; Equipment has a setup checklist. The Judge / scores view focuses on adjudication, timing and scores. Each support team has its own duties; Equipment holds all 21 purchased/available items in a checklist with a ready count. Anyone can tick items on their device; ticks save locally, survive reloads and remain private when shared scores update. Game buttons open event-specific notes. Department selection, sound and private reminders survive reloads; previous checklist data stays readable in backups. Reminders remain device-only and excluded from posters.
- **Team colours:** the home legend shows each leader’s name when entered, otherwise the colour name. Five fixed slots keep long names from moving the layout. Team names in games and scores keep their own labels.
- **Leading team:** a small crown marks the highest overall points in Team colours and Scores. Tied leaders share the crown; no crown appears before a game has finished.
- **Scores:** read-only game sheets update automatically. Completed rounds cannot be edited through another tab. Each game automatically adds its championship points after all configured rounds or attempts finish. Tied totals share competition places and points; Tug-of-War semifinal losers share third. Completed home cards and scoring controls are disabled and translucent. Use Scores or the rundown to review a finished game and reach its reset controls. Championship points use placing, not raw counts.
- **Reset:** the timer desk has separate round/attempt/match and whole-game resets, each with confirmation. **Reset / backup** on Home offers full-event reset and validated JSON backup/import. Public PNGs exclude private notes and leaders.
- **Share / export:** scan the QR code to open the public live page, copy its link or download the QR as a PNG. The QR is stored locally and available offline after the first visit. Full poster (1536 × 1610) and phone story (1080 × 1920) exports stay below it. Choose a format, then Share or Download PNG. Share checks the browser’s capabilities and opens the device’s native share sheet directly with the prepared PNG where supported. Browsers that support links but not files, including Firefox on Android, share a canonical link to the selected poster format instead. Older link-sharing browsers do not need canShare. If native sharing is unavailable or blocked, a compact copyable poster link and browser Share-menu guidance appear. A file-support mismatch offers link sharing on the next tap, preserving the browser’s user-activation requirement. Share never opens a website picker, changes browser preferences or downloads automatically; Download PNG remains separate. Only the public PNG or canonical poster link is shared. Regenerate after team or bracket changes.

The scorekeeper’s results queue locally and publish automatically after confirmation from Supabase. Offline results remain marked Pending; viewers keep the last confirmed snapshot. Realtime notifications refresh viewers, with polling as fallback. Writer ownership survives lease expiry; moving to another phone requires an explicit Transfer. Revision checks and operation IDs protect against stale or repeated writes. If shared results conflict with pending device results, editing stops until the scorekeeper downloads a backup and deliberately loads shared scores.

An original device backup is preserved once before first adopting shared results. Reset / backup can download that copy or restore its public scores while keeping current committee names and private notes. Public snapshots contain team names/seeds, committee names, game results and clocks; they exclude leaders, headcounts, committee reminders and free-text rule notes. Existing version-1 backups remain readable. Use the same URL consistently: `localhost` and `127.0.0.1` have separate browser storage.

## Supabase setup

Create the scorekeeper privately under Authentication → Users. Fill the placeholder email at the end of `supabase/schema.sql` and run the whole script in SQL Editor. The script preserves any existing event scores. It creates a private editor allowlist, public read-only results and committee rosters, guarded authenticated write functions and realtime publication. Never commit a filled private setup script, password, service-role key or secret key. The public publishable key is intended for browser use.

For an existing deployment, apply `supabase/committee-roster.sql` before publishing the editable roster. It preserves scores, revisions, leases and operation retries; older clients cannot erase committee names by omitting the new field. Private reminders remain excluded from public snapshots.

Sign in with the scorekeeper account through Live scores. Other phones stay as viewers. Use Transfer scorekeeping here only when moving the main desk. Download a backup before transferring or clearing pending results. Real background audio remains browser-dependent; the timer uses deadlines so the clock catches up when a phone wakes.

If saved data cannot be read, the original record is protected from ordinary saves. **Download JSON backup** retains that original record; importing a valid backup or explicitly resetting authorizes its replacement. New entries cannot save while the original record is protected. Restored partial Borrow and Relay rounds preserve saved results and use the remaining score slots.

## Files

- `index.html`, `palette.css`, `styles.css`, `landing.css`, `desk.css`, `app.js`: interface, responsive layout and interactions. `palette.css` owns colour roles, spacing and radii; `desk.css` groups shared panel controls. The home keeps the approved winding game route.
- `model.js`: draw, advancement, scoring, tie resolution and import validation.
- `live.js`, `timer-model.js`, `rounds.js`, `flow-model.js`, `panel-navigation.js`: shared timers, match overlay, automatic result entry, incomplete-round targets and panel navigation.
- `device-store.js`, `before-sync.js`, `view-state.js`, `sw.js`: protected device saving, pre-sync recovery, focus/settings preservation and complete offline releases.
- `sync.js`, `sync-config.js`, `supabase/schema.sql`: shared score protocol, public connection settings and database setup.
- `content.js`, `icons.js`: brief-derived notes and local SVG icons.
- `media.js`, `media-share.js`: deterministic public PNG exports, native image/link sharing, copyable-link fallback and separate PNG downloads.
- `assets/`: locally bundled Poppins fonts, SIL Open Font License, favicon and the pinned MIT-licensed Supabase 2.117.2 browser client.
- `schedule.json`, `PROJECT_BRIEF.md`, `reference.png`: preserved source materials.

## Verification

Run the domain, timer, round workflow, popup gesture, desk integration, sync protocol, backend contract, offline and storage tests with Node 18+ (no packages required):

```sh
node tests/model.test.mjs
node tests/timer.test.mjs
node tests/rounds.test.mjs
node tests/popup.test.mjs
node tests/live.test.mjs
node tests/offline.test.mjs
node tests/storage.test.mjs
node tests/sync.test.mjs
node tests/backend.test.mjs
node tests/before-sync.test.mjs
node tests/flow.test.mjs
node tests/view-state.test.mjs
node tests/private-state.test.mjs
node tests/connection-badge.test.mjs
node tests/timeline.test.mjs
node tests/schedule.test.mjs
node tests/media-share.test.mjs
```

Coverage includes bracket advancement and invalidation, seed validation, score conversion, ties, saved deadline clocks, ordered success/failure scoring, duplicate tap protection, Cavalry elimination/points, completion locks, scoped resets and backup compatibility. Regression checks cover partial historical score continuation, malformed backups, protected storage, typed counts at expiry, timer reset indicators, the first Play tap after a limit edit, exact offline asset versions and interrupted updates.

Release 26 passed 258 automated checks, including live following/manual review, Next wrapping to unfinished work, guarded Undo, fresh state after reset confirmation, one primary action across popups, draft isolation, and private checklist/preference backups. Browser checks used an isolated local scorekeeper preview and an anonymous read-only live viewer; production scores were not edited.

The final flow check completed all Borrow rounds and verified automatic championship points, tested Cavalry Undo without interrupting its timer, restored Committee checks/reminders after Back and reload, retained Basket Blue / attempt 2 after returning from sync, and returned focus to an enabled control after a game completed. At 320 × 667, Play and Next remained visible; home and seven main panels showed no horizontal overflow at 390 × 844, 768 × 1024 and 1280 × 720. The Director inventory now uses the single shared Temu cart, following the later shopping-list instructions.

The October 7 inspection checked timer expiry with an unblurred count, its saved score sheet, keyboard focus/settings retention, overlay/main-desk count consistency, and all ten main panels at 320 CSS pixels. The landing page fit 320 × 667 without overflow. Offline failures were checked against the real worker source with simulated network/cache events; real device flight-mode behavior remains untested.

The interface was checked in Safari on desktop and at 390/320 CSS pixels using `tests/responsive.html`. Both phone widths reported document width and height within the home viewport. Live Borrow scoring reached the sheet and locked; Cavalry selection, live elimination, automatic points, round reset and phone overlay return were exercised. A seeded tug match accepted its winner while running and advanced to the correct semifinal. Real iOS/Android hardware has not been tested.

The original `PROJECT_BRIEF.md` is preserved as source history. The later user instructions supersede its Cavalry eligibility/scoring approval workflow.

The landing-page refinement was visually checked on desktop, a tablet-sized viewport, 390 × 844 and 320 × 667 phone previews. Both phone views fit their viewport; the new Rundown / Games switch preserves readable text. Styling is isolated in `landing.css`; the printed/exported reference poster retains its own layout.

## October 17 design and security review

The interface combines several references rather than copying one template:

| Reference | Used for |
| --- | --- |
| [Figma: Purity UI Dashboard](https://www.figma.com/community/file/1020707462188017225/purity-ui-dashboard-chakra-ui-dashboard/) | Consistent rounded cards, clear control hierarchy and quiet borders. |
| [Figma: Dashboard Tennis](https://www.figma.com/community/file/882171933811828307/dashboard-tennis/) | Compact match summaries and a clear distinction between scores and supporting information. |
| [Figma: Simple dashboard](https://www.figma.com/community/file/1048559673287861086/dashboard/) | Restrained information density and aligned panels. |

These designs are listed in [Figma's dashboard collection](https://www.figma.com/templates/dashboard-designs/). The colour direction draws on Jade, Cool Blue and Plum Noir from [Pinterest Palette 2026](https://newsroom.pinterest.com/news/from-cool-blue-to-persimmon-meet-the-2026-pinterest-palette/). The app uses its own muted shades with warm ivory surfaces and readable dark text, rather than the report's exact swatch values. Team colours retain their identifying role. No third-party template assets are embedded.

- Shared colour roles live in `palette.css`. Canvas poster exports read the same CSS colours; their established dimensions and content layout stay intact.
- Cards, inputs, tabs, notes and button groups use the same spacing and corner sizes. Timer/scoring actions have 44px minimum targets. Tabs and rounds can scroll within their own strip on small screens.
- The home preserves the five-stop S route, fixed team-name slots, compact date and separate location card. Short phones give the illustrations their own row above the game caption.
- CSS has been formatted for maintenance and declarations overridden by later rules with the same selector have been removed. Local `?local` previews do not install a service worker, so development changes are not hidden behind an old release cache. Use a fresh local port after previewing a previously cached release.
- New panels, rounds and reopened dialogs start at the top. Same-view updates retain drafts, focus and scroll; Back still restores the previous view. The Scores overview pins the team and Total columns while individual game columns scroll on narrow phones.

Release 32 passed all 269 automated checks. Firefox inspection covered the 320 × 667 home in both modes, each game desk, the big match screen, committee departments, teams, scores, location, sharing, backup and scorekeeper panels. Wider phone, tablet and desktop proportions were also inspected. The hidden-dialog scroll regression was reproduced and checked again after its fix. Poster and phone-story previews rendered under the new CSP. Real phone keyboards, safe areas and a two-device event-day rehearsal remain untested.

### Security boundaries

The page now declares a Content Security Policy before loading resources. Scripts and fonts come from the site; network connections are limited to the site and the configured Supabase HTTPS/WSS endpoints. Inline scripts, object embeds, base-tag overrides and native form submissions are blocked. Inline styles remain necessary for team colours and draggable timers. External navigation sends no referrer. [CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).

Live checks on October 17 confirmed that public score reads succeed, anonymous writer claims/result updates/direct table writes are denied, and the private editor schema is not exposed. Permission probes used a nonexistent event; no event results were changed. The live public snapshot contained none of the checked private notes, participant details or login-token fields. All three application tables explicitly enable RLS. Backend tests cover exact public payload keys, restricted grants, the assigned scorekeeper check, revisions and writer leases. [Supabase access-control reference](https://supabase.com/docs/guides/database/postgres/row-level-security).

Private JSON backups contain this phone's leaders and committee reminders and are labelled accordingly. The app's backup functions export event state rather than authentication storage. Scorekeeper sessions persist in browser storage for event-day continuity; Sign out clears that session. Device-only notes and downloaded backups are not encrypted by the app.

The review does not certify the entire cloud account. Account MFA, backup retention and GitHub administrative settings require a project-owner dashboard review. GitHub Pages cannot apply custom response headers such as CSP `frame-ancestors` through an HTML meta tag.

### Supabase account move

At the user's request, the site now uses the new `cgs` project in the CGS organization on the current Supabase account, hosted in Seoul. Only the project URL and browser-safe publishable key are included in the site. Public signups and anonymous sign-ins are disabled. The same sole scorekeeper was created privately by the user and assigned using that project's new Auth UID.

The last confirmed public snapshot from the previous project (revision 37, no active timer) was validated and imported atomically. The destination starts at revision 1; its public state was compared with the source before and after verification. All 28 database role checks passed in an isolated event, and every test change was rolled back. The browser viewer connected successfully with the new endpoint and CSP.

Device-only leaders, headcounts, reminders and preferences remain on each browser. A separate recovery key captures meaningful device state before the browser first adopts the new server, preserving the original before-sync backup as well. Old Auth sessions and pending sync queues are not copied into the new project.

Refresh or reopen every viewing/scoring tab after deployment and sign in with the new scorekeeper login. Old tabs can still contact the previous project until refreshed; its administrator access was unavailable, so it has not been disabled or deleted. Keep the ignored private migration snapshot for recovery. After new results are recorded, any rollback must carry those newer results back before switching endpoints.

## October 18 alignment inspection

Release 33 gives CG, / EVENT DESK and the connection label separate text boxes with a shared vertical center and explicit line heights. The caption alone hides on smaller screens. Import backup now centers its label, narrow-phone export controls stack so the complete format and dimensions remain readable, and the phone team legend reserves clearance for a leading-team crown. The timer's drag shadow also uses a valid colour value.

`tests/responsive.html` provides a local editable preview with read-only geometry measurements in `tests/responsive.js`. The home in both modes and all main panel/game timer layouts were checked at 320 × 667, 390 × 844, 768 × 1024 and 1280 × 720. The inspection also covered every game sheet, format and department tab, all seven general committee departments, supporting event notes, the standalone timer and the big match screen. Long team/leader names and a leading-team crown were tested using a temporary backup imported into an isolated local preview; no shared results were changed. Tables, brackets and tab strips retain intentional internal scrolling, and team labels retain deliberate ellipsis. These browser measurements do not replace real-device keyboard and safe-area testing.
