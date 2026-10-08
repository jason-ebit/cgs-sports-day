# CG Sports Day

## Use on a phone

The published site is installable and keeps its app shell available offline after the first successful visit. On iPhone, open the GitHub Pages URL in Safari, choose **Share → Add to Home Screen**, and open it once while online. On Android, open the URL in Chrome and choose **Install app** or **Add to Home screen**.

Shared scores, brackets and timers use Supabase. Everyone watches the same GitHub Pages link; one registered scorekeeper signs in through the status indicator in the top bar. Its panel is marked **Scorekeeper only**. A green blinking ● Live appears only while connected with confirmed scores; Pending / Review and Offline remain distinct. Committee reminders, leaders and headcounts stay in the browser on that phone. Use **Reset / backup → Download JSON backup** to safeguard device data.

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
- **Calendar:** tap the date card to review and save a pre-filled Google Calendar event for October 25, 2026, 11:40–16:00 in Korea time. It includes the venue, walking directions, toilet link and live site; the description notes the participant start at 12:00.
- **Game desk:** games open on **Timer & scoring**, with numbered rounds/attempts above the controls. Round selection stays shared across Timer, Scores, Format and Committee tabs. Team choices are rounded colour buttons. A single Play / Pause / Next action stays visible on phones while results scroll. Next names its destination and skips finished work, including missing earlier rounds.
- **Follow live:** spectators follow the active round or match within the selected game. Choosing a round or team enters Review; **Follow live** resumes following. Spectator desks show timers and results without scoring inputs, timer settings or reset menus. The in-game connection label updates without rebuilding input fields.
- **Back:** linked panels return to their previous tab, department, round/attempt, focus and scroll position. Updates preserve unfinished input drafts when the underlying saved value is unchanged; genuine shared changes take precedence.
- **Undo:** Borrow, Relay and Cavalry offer one session-only Undo for the last accepted result while its round is unfinished. It preserves the clock and checks that no later result or reset has replaced that tap. Completed rounds stay locked; corrections then use the existing scoped reset.
- **Opening:** Prayer runs 12:15–12:17, followed by Opening / Safety 12:17–12:20. All game times stay the same. The rundown and poster exports show the new slot in chronological order; existing saved event notes and timers keep their original identities.
- **Borrow-a-Thing:** tap **Success** in arrival order: 5 / 4 / 3 / 2 / 2. **Fail** awards zero and does not consume a success rank. Every team recorded completes and locks the round. Six rounds by default; the Scores tab can include the seventh contingency round.
- **Ball Basket:** select a team and attempt, count with + / − or enter the count, then **Finish attempt & lock**. Valid counts save while typing, including before timer expiry. The higher of two counts determines game placing.
- **Cavalry:** rounds 1 and 2 retain the existing women’s and men’s divisions. Select arena teams directly, press Play, then tap **Horse out** in elimination order while the timer runs. Last survivor gets 5, then 4 / 3 / 2 / 1 in reverse elimination order; teams outside that round receive 0. Both rounds are added, then converted to championship placing. The five-minute starting timer is adjustable; it is an operational preset, not a confirmed event rule. Eligibility forms and manual scoring approval are removed.
- **Tug-of-War:** use random draw, unique seeds, or colour buttons for manual slots. Duplicate assignment swaps teams. Lock the draw, then run matches; selecting a winner saves and advances the bracket, ending and locking that match. Resetting an earlier match also clears dependent results and timers. The final awards championship points automatically; semifinal losers share third place.
- **Team Relay:** tap each team’s **Finish** in arrival order. Places convert to 5 / 4 / 3 / 2 / 1 points. Completing all five results locks the round.
- **Timer:** play/pause, +30 seconds, editable limits, optional end sound, timer-only reset and 30-second tug rematch. Every round, match and attempt requires Play before results can be entered. Pausing keeps scoring available; resetting the timer requires Play again. One timer runs at a time; starting another pauses the previous one. Saved deadlines keep elapsed time accurate across tabs, popups and reloads. Background audio depends on browser support; this is not a system alarm.
- **Big screen:** overlays the game popup and returns to it when closed. Tap controls normally; hold and drag anywhere on either timer to move it. Drop onto the red circular X to hide it. Arrow keys move a focused timer popup without affecting its inputs. Hiding either popup keeps the timer running. All views use the same clock and results.
- **Committee:** department tabs for Judge / scores, Assistant judge, First aid, Equipment, Food & water, Comm and Team leaders. One main judge makes final decisions and enters scores; the assistant oversees play and confirms observations with the main judge. Support cover totals 9–10: First aid 2, Equipment 3, Food & water 2–3 and Comm 2, separate from both judges. The Judge / scores reminder input is replaced by the handover inventory: already-owned items, supplies to buy/prepare and one shared Temu cart link. Event Judge / scores views link back to that inventory. Game buttons open each department’s event notes directly. Readiness checks, the selected department and end-sound preference stay on this phone and survive reloads. Other department reminders are stored separately, included in JSON backups and excluded from posters.
- **Team colours:** the home legend shows each leader’s name when entered, otherwise the colour name. Five fixed slots keep long names from moving the layout. Team names in games and scores keep their own labels.
- **Leading team:** a small crown marks the highest overall points in Team colours and Scores. Tied leaders share the crown; no crown appears before a game has finished.
- **Scores:** read-only game sheets update automatically. Completed rounds cannot be edited through another tab. Each game automatically adds its championship points after all configured rounds or attempts finish. Tied totals share competition places and points; Tug-of-War semifinal losers share third. Completed home cards and scoring controls are disabled and translucent. Use Scores or the rundown to review a finished game and reach its reset controls. Championship points use placing, not raw counts.
- **Reset:** the timer desk has separate round/attempt/match and whole-game resets, each with confirmation. **Reset / backup** on Home offers full-event reset and validated JSON backup/import. Public PNGs exclude private notes and leaders.
- **Share / export:** scan the QR code to open the public live page, copy its link or download the QR as a PNG. The QR is stored locally and available offline after the first visit. Full reference-layout PNG (1536 × 1610) and phone story (1080 × 1920) exports stay below it; regenerate those after team or bracket changes.

The scorekeeper’s results queue locally and publish automatically after confirmation from Supabase. Offline results remain marked Pending; viewers keep the last confirmed snapshot. Realtime notifications refresh viewers, with polling as fallback. Writer ownership survives lease expiry; moving to another phone requires an explicit Transfer. Revision checks and operation IDs protect against stale or repeated writes. If shared results conflict with pending device results, editing stops until the scorekeeper downloads a backup and deliberately loads shared scores.

An original device backup is preserved once before first adopting shared results. Reset / backup can download that copy or restore its public scores while keeping current private notes. Public snapshots contain team names/seeds, game results and clocks; they exclude leaders, headcounts, committee reminders and free-text rule notes. Existing version-1 backups remain readable. Use the same URL consistently: `localhost` and `127.0.0.1` have separate browser storage.

## Supabase setup

Create the scorekeeper privately under Authentication → Users. Fill the placeholder email at the end of `supabase/schema.sql` and run the whole script in SQL Editor. The script preserves any existing event scores. It creates a private editor allowlist, public read-only results, guarded authenticated write functions and realtime publication. Never commit a filled private setup script, password, service-role key or secret key. The public publishable key is intended for browser use.

Sign in with the scorekeeper account through Live scores. Other phones stay as viewers. Use Transfer scorekeeping here only when moving the main desk. Download a backup before transferring or clearing pending results. Real background audio remains browser-dependent; the timer uses deadlines so the clock catches up when a phone wakes.

If saved data cannot be read, the original record is protected from ordinary saves. **Download JSON backup** retains that original record; importing a valid backup or explicitly resetting authorizes its replacement. New entries cannot save while the original record is protected. Restored partial Borrow and Relay rounds preserve saved results and use the remaining score slots.

## Files

- `index.html`, `styles.css`, `landing.css`, `desk.css`, `app.js`: interface, responsive layout and interactions. `desk.css` groups shared panel spacing, committee checks and desk actions without changing the approved landing map.
- `model.js`: draw, advancement, scoring, tie resolution and import validation.
- `live.js`, `timer-model.js`, `rounds.js`, `flow-model.js`, `panel-navigation.js`: shared timers, match overlay, automatic result entry, incomplete-round targets and panel navigation.
- `device-store.js`, `before-sync.js`, `view-state.js`, `sw.js`: protected device saving, pre-sync recovery, focus/settings preservation and complete offline releases.
- `sync.js`, `sync-config.js`, `supabase/schema.sql`: shared score protocol, public connection settings and database setup.
- `content.js`, `icons.js`: brief-derived notes and local SVG icons.
- `media.js`: deterministic canvas rendering of public PNG exports.
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
```

Coverage includes bracket advancement and invalidation, seed validation, score conversion, ties, saved deadline clocks, ordered success/failure scoring, duplicate tap protection, Cavalry elimination/points, completion locks, scoped resets and backup compatibility. Regression checks cover partial historical score continuation, malformed backups, protected storage, typed counts at expiry, timer reset indicators, the first Play tap after a limit edit, exact offline asset versions and interrupted updates.

Release 26 passed 258 automated checks, including live following/manual review, Next wrapping to unfinished work, guarded Undo, fresh state after reset confirmation, one primary action across popups, draft isolation, and private checklist/preference backups. Browser checks used an isolated local scorekeeper preview and an anonymous read-only live viewer; production scores were not edited.

The final flow check completed all Borrow rounds and verified automatic championship points, tested Cavalry Undo without interrupting its timer, restored Committee checks/reminders after Back and reload, retained Basket Blue / attempt 2 after returning from sync, and returned focus to an enabled control after a game completed. At 320 × 667, Play and Next remained visible; home and seven main panels showed no horizontal overflow at 390 × 844, 768 × 1024 and 1280 × 720. The compact Director inventory retained all five shopping links.

The October 7 inspection checked timer expiry with an unblurred count, its saved score sheet, keyboard focus/settings retention, overlay/main-desk count consistency, and all ten main panels at 320 CSS pixels. The landing page fit 320 × 667 without overflow. Offline failures were checked against the real worker source with simulated network/cache events; real device flight-mode behavior remains untested.

The interface was checked in Safari on desktop and at 390/320 CSS pixels using `tests/responsive.html`. Both phone widths reported document width and height within the home viewport. Live Borrow scoring reached the sheet and locked; Cavalry selection, live elimination, automatic points, round reset and phone overlay return were exercised. A seeded tug match accepted its winner while running and advanced to the correct semifinal. Real iOS/Android hardware has not been tested.

The original `PROJECT_BRIEF.md` is preserved as source history. The later user instructions supersede its Cavalry eligibility/scoring approval workflow.

The landing-page refinement was visually checked on desktop, a tablet-sized viewport, 390 × 844 and 320 × 667 phone previews. Both phone views fit their viewport; the new Rundown / Games switch preserves readable text. Styling is isolated in `landing.css`; the printed/exported reference poster retains its own layout.
