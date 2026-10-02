# CG Sports Day

## Use on a phone

The published site is installable and keeps its app shell available offline after the first successful visit. On iPhone, open the GitHub Pages URL in Safari, choose **Share → Add to Home Screen**, and open it once while online. On Android, open the URL in Chrome and choose **Install app** or **Add to Home screen**.

Scores, timers, team names and notes stay in that browser on that phone. Use **Share / export → Download JSON backup** to move or safeguard event data.

Working responsive rundown and game desk, built from `reference.png`, `PROJECT_BRIEF.md` and the approved `schedule.json`. Date: **OCT 25**, with no invented year or weekday. Venue: **대현산배수지공원**.

## Run

No install, build step, external runtime assets or API keys are needed. From this folder:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open **http://127.0.0.1:4173**. Keep the terminal running. Serve over HTTP; double-clicking `index.html` will not load the JavaScript modules / schedule reliably. The live app is at https://jason-ebit.github.io/cgs-sports-day/.

## Use

- **Home:** the landing page uses a wide, screen-filling grid with readable type, aligned cards and muted sage / gold / rose accents. Phones have a **Rundown / Games** switch so each view fits without shrinking the entire poster. **Expand layout** offers the roomier scrollable version. A running or paused game stays highlighted with its matchup and timer.
- **Game desk:** games open on **Timer & scoring**, with numbered rounds/attempts above the controls. Round selection stays shared across Timer, Scores, Format and Committee tabs. Team choices are rounded colour buttons. Essential rules and committee checklists remain separate.
- **Opening:** Prayer runs 12:15–12:17, followed by Opening / Safety 12:17–12:20. All game times stay the same. The rundown and poster exports show the new slot in chronological order; existing saved event notes and timers keep their original identities.
- **Borrow-a-Thing:** tap **Success** in arrival order: 5 / 4 / 3 / 2 / 2. **Fail** awards zero and does not consume a success rank. Every team recorded completes and locks the round. Six rounds by default; the Scores tab can include the seventh contingency round.
- **Ball Basket:** select a team and attempt, count with + / − or enter the count, then **Finish attempt & lock**. The higher of two counts determines game placing.
- **Cavalry:** rounds 1 and 2 retain the existing women’s and men’s divisions. Select arena teams directly, press Play, then tap **Horse out** in elimination order while the timer runs. Last survivor gets 5, then 4 / 3 / 2 / 1 in reverse elimination order; teams outside that round receive 0. Both rounds are added, then converted to championship placing. The five-minute starting timer is adjustable; it is an operational preset, not a confirmed event rule. Eligibility forms and manual scoring approval are removed.
- **Tug-of-War:** use random draw, unique seeds, or colour buttons for manual slots. Duplicate assignment swaps teams. Lock the draw, then run matches; selecting a winner saves and advances the bracket, ending and locking that match. Resetting an earlier match also clears dependent results and timers. The final awards championship points automatically; semifinal losers share third place.
- **Team Relay:** tap each team’s **Finish** in arrival order. Places convert to 5 / 4 / 3 / 2 / 1 points. Completing all five results locks the round.
- **Timer:** play/pause, +30 seconds, editable limits, optional end sound, timer-only reset and 30-second tug rematch. Every round, match and attempt requires Play before results can be entered. Pausing keeps scoring available; resetting the timer requires Play again. One timer runs at a time; starting another pauses the previous one. Saved deadlines keep elapsed time accurate across tabs, popups and reloads. Background audio depends on browser support; this is not a system alarm.
- **Big screen:** overlays the game popup and returns to it when closed. Use the grip to move it; drag to the red area to close it. The floating timer can also be moved and hidden. Hiding either popup keeps the timer running. All views use the same clock and results.
- **Committee:** separate department tabs for Director / scores, Judges, First aid, Equipment, Food & water, Comm and Team leaders. The Director reminder input is replaced by the handover inventory: already-owned items, supplies to buy/prepare and five recorded shopping links. Event Director views link back to that inventory. Game buttons open each department’s event notes directly. Other department reminders are stored separately, included in JSON backups and excluded from posters.
- **Team colours:** the home legend shows each leader’s name when entered, otherwise the colour name. Five fixed slots keep long names from moving the layout. Team names in games and scores keep their own labels.
- **Leading team:** a small crown marks the highest overall points in Team colours and Scores. Tied leaders share the crown; no crown appears before a game has finished.
- **Scores:** read-only game sheets update automatically. Completed rounds cannot be edited through another tab. Each game automatically adds its championship points after all configured rounds or attempts finish. Tied totals share competition places and points; Tug-of-War semifinal losers share third. Completed home cards and scoring controls are disabled and translucent. Use Scores or the rundown to review a finished game and reach its reset controls. Championship points use placing, not raw counts.
- **Reset:** the timer desk has separate round/attempt/match and whole-game resets, each with confirmation. **Reset / backup** on Home offers full-event reset and validated JSON backup/import. Public PNGs exclude private notes and leaders.
- **Share / export:** full reference-layout PNG (1536 × 1610) and phone story (1080 × 1920). Use the app to regenerate after team or bracket changes.

Changes save to this browser’s local storage. There is **no live multi-device sync**, server database or automatic cloud backup. Use the same URL consistently: `localhost` and `127.0.0.1` have separate browser storage. Existing version-1 backups remain readable.

## Files

- `index.html`, `styles.css`, `landing.css`, `app.js`: interface, responsive layout and interactions.
- `model.js`: draw, advancement, scoring, tie resolution and import validation.
- `live.js`, `timer-model.js`, `rounds.js`: shared timers, match overlay and automatic result entry.
- `content.js`, `icons.js`: brief-derived notes and local SVG icons.
- `media.js`: deterministic canvas rendering of public PNG exports.
- `assets/`: locally bundled Poppins fonts, SIL Open Font License, favicon.
- `schedule.json`, `PROJECT_BRIEF.md`, `reference.png`: preserved source materials.

## Verification

Run the 48 domain, timer and round workflow tests with Node 18+ (no packages required):

```sh
node tests/model.test.mjs
node tests/timer.test.mjs
node tests/rounds.test.mjs
```

Coverage includes bracket advancement and invalidation, seed validation, score conversion, ties, saved deadline clocks, ordered success/failure scoring, duplicate tap protection, Cavalry elimination/points, completion locks, scoped resets and backup compatibility.

The interface was checked in Safari on desktop and at 390/320 CSS pixels using `tests/responsive.html`. Both phone widths reported document width and height within the home viewport. Live Borrow scoring reached the sheet and locked; Cavalry selection, live elimination, automatic points, round reset and phone overlay return were exercised. A seeded tug match accepted its winner while running and advanced to the correct semifinal. Real iOS/Android hardware has not been tested.

The original `PROJECT_BRIEF.md` is preserved as source history. The later user instructions supersede its Cavalry eligibility/scoring approval workflow.

The landing-page refinement was visually checked on desktop, a tablet-sized viewport, 390 × 844 and 320 × 667 phone previews. Both phone views fit their viewport; the new Rundown / Games switch preserves readable text. Styling is isolated in `landing.css`; the printed/exported reference poster retains its own layout.
