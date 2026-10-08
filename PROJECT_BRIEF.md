# CG Sports Day — Codex handoff

This is a consolidated project brief from the ChatGPT conversation, NOT a verbatim chat export or an implemented web app. Latest user decisions override older artwork and planning suggestions. Use `reference.png` as the visual baseline and `schedule.json` for the approved schedule.

## Immediate task

Build a working, responsive interactive sports-day rundown and game-management interface. Match the supplied reference's typography, layout, alignment, margins, spacing, icons and rounded cards as closely as practical. Do not simply display the reference as a background image with controls on top.

The user's most recent implementation request:
> Edit current picture: you should bracket tug-of-war, team opposition matching should be drawn i think. For cavalry im thinking of a deathmatch with all teams. I want an interactive artifact adhering to the exact design, alignment and margins, then implement input-based bracket and seeding system, dropdown without moving the entire list with a separate container, a bit rounded card for the things to note/desc of each event point. Optimise for both web app and also media on phone.

The user then asked to move the work to Codex. No completed interactive app source is included in this handoff.

## Event and participants

- Title: CG SPORTS DAY.
- Date: OCT 25. Do not add a year or weekday: neither was explicitly confirmed. Some previous generated images invented 2024/Saturday; those are not authoritative.
- Venue: 응봉공원 · 다목적구장. Meet at the second, larger rectangular court on the supplied park map.
- Venue map: https://naver.me/59lqYcXJ. Toilet map: https://naver.me/G6RwJ9lQ.
- Walking guide: from the entrance turn right, go up the stairs, then right to the larger court. Both supplied HEIC attachments were the same entrance photo; the distinct staircase photo is still needed.
- Committee arrival: 11:40; participant program: 12:00–16:00; field clear by 16:00.
- Five mixed teams, roughly 6–8 members each; around 15 men (unconfirmed) and 15–20+ women.
- Default team identifiers: Red, Blue, Yellow, Green, White. Team names and leaders are editable, not already known.
- Team allocation: separate male/female pools of coloured sticks to balance distribution; adjust pool counts to actual attendance.
- Leaders oversee members, attendance, substitutions, participation and wellbeing; report concerns to first aid.

## Design decisions

- Baseline is the user's selected second design, developed into `reference.png`; do not revert to earlier alternatives.
- Poppins preferred for Latin text; use an appropriate Korean fallback for the venue.
- Minimal black-and-white design with only established accents: the five team colours, warm yellow Break, pale green Results / Prizes, pale pink/red Finish.
- White canvas, black bold heading, fine light-grey outlines/dividers, restrained rounded corners, generous consistent padding.
- Desktop: schedule on the left, team legend and game-format cards on the right; compact date/time/venue card in the top right.
- Small game-number badges with breathing room between number, icon and title; never oversized.
- Keep extra vertical padding below TEAM COLOURS before the colour dots.
- Distinct icons: magnifying glass for Borrow-a-Thing; basket for Ball Basket; horse/rider for Cavalry Game; rope for Tug-of-War; baton for Team Relay.
- Remove philosophical quotes, motivational slogans and catchphrases.
- Schedule contains concise headlines/times. Descriptions and notes belong in a separate slightly rounded detail card/container.
- Dropdowns/popovers must overlay or use a separate detail area instead of expanding rows and shifting the entire schedule. On a phone, a drawer/bottom sheet is a suggested implementation, not an extra user requirement.
- Responsive phone layout must preserve readability and all functions, not just shrink the desktop poster. Provide a clean shareable phone-media/poster presentation as well as the interactive web view.

## Interactive functionality

Requested:
- Editable team names and participant/seed inputs.
- Draw-based Tug-of-War opposition and a real working bracket.
- Appropriate game-specific formats instead of fake knockout trees everywhere.
- Separate dropdown/detail container; rounded notes per event.
- Desktop and phone optimisation, including media output.

Suggested implementation details, not prior settled decisions:
- Randomise unique bracket slots, permit manual assignment, lock the draw, input winners and update dependent matches.
- Prevent duplicate team assignments and impossible/self matchups.
- A five-team single-elimination bracket needs one preliminary match, three first-round byes, two semifinals and a final. Byes mean advancement, NEVER automatic fifth place. A third-place match or explicit shared placing is needed if unique championship places are required. Confirm that format before fixing rankings.
- If an earlier result changes, clear or explicitly revalidate downstream results.
- Local save plus JSON import/export and reset confirmation are useful. Never imply multi-user/live syncing without implementing it.
- Keep unresolved rules visibly configurable; do not invent game results, rankings, attendance or safety approval.
- Test desktop and narrow-phone views, dropdown placement, bracket logic and media output.

## Game formats and scoring

### 1. Borrow-a-Thing — 20 minutes
- All five teams participate simultaneously with one runner each round. No elimination bracket.
- Six rounds normally; seventh contingency round for teams of seven, within the same 20-minute allocation. Smaller teams can rotate; equal scoring opportunities across teams.
- R1 Easy: 90 seconds; R2 Easy: 90 seconds; R3 Medium: 120 seconds; R4 Borrow-a-Person: 120 seconds; R5 Medium: 120 seconds; R6 Funny/Chaos: 120 seconds; R7 contingency: 90 seconds.
- Prepare about 45 cards; only 30–35 are used. Each round draws five cards from one category; don't return used cards to the deck.
- Different runner until everyone willing has had a turn.
- Valid finish points: 5, 4, 3, 2, 2; invalid/timeout: 0. Sum rounds, rank, then convert to championship placement points.
- Borrow with consent; no sensitive/expensive objects, medication or removing active first-aid personnel from duty.
- Time budget with 7 rounds: 2 min explanation + 12.5 min action + 1.5 min transitions + 4 min scoring/buffer = 20 min.

### 2. Ball Basket — 25 minutes
- Display name is Ball Basket, not Tamaire; inspired by Japanese tamaire.
- Teams take turns, two 30-second attempts each; best successful-ball count determines placing. No elimination bracket.
- Reuse lightweight coloured ping-pong balls and a lightweight laundry basket; no long pole because the organiser commutes.
- Earlier plan: stationary committee-held basket with an exclusion zone. Do not treat this as a safety certification; test visibility, stability, stray balls and wind before use.
- Equal participant opportunities, ball quantities and throwing distances must be set before play.
- Earlier tie suggestion: 15-second playoff, subject to available time.

### 3. Cavalry Game — 45 minutes
- Display name is Cavalry Game, not Kibasen. Horse or rider icon.
- Latest proposed format: all-in battle / deathmatch among eligible horses, NOT the head-to-head bracket shown in the old reference.
- Same-gender horses and same-gender divisions remain the earlier contact preference.
- One horse = three bases + one rider; only riders require cloth hachimaki.
- Critical unresolved attendance issue: five same-gender horses require 20 eligible participants in that division. With about 15 men and possibly fewer than 20 women, don't silently assume every main team can form a horse. Allow eligibility/attendance input and flag incomplete horses. Ask the organiser how to handle ineligible teams and points.
- All-in scoring, time cap and safety arrangements have NOT been finalised after the format change. Old 90-second head-to-head rules must not silently be treated as the all-in rules.
- Provide a proposed configurable arena/active-team and elimination-order UI, but do not show fabricated outcomes or finalise unapproved scoring.
- A previous cloth bow-knot suggestion is not a verified breakaway mechanism. Safety decisions need separate review. Do not reward causing a fall or collapse.

### 4. Tug-of-War — 35 minutes
- Latest request: actual tournament bracket with opponents determined by a draw, not fixed opponents or all teams pulling simultaneously.
- Earlier target: equal puller counts, usually 6v6 subject to available members.
- Earlier match timing: 60 sec; unresolved draw followed by reset and a 30-sec rematch. Final unresolved outcomes and precise bracket/placement rules still need confirmation.
- Earlier selected rope concept was 20 mm × 10 m, with coated work gloves. Neither rope suitability/strength nor safe team capacity was verified. Do not carry earlier chat's confident safety claims into the app.
- No rope wrapping around hands/wrists/body, no intentional sudden release, stop for injury.

### 5. Team Relay — 30 minutes
- All five teams race together; no elimination bracket.
- Round 1: Baton Relay, around 8 minutes including setup/reset.
- Round 2: Three-Legged Relay, around 10 minutes including practice/ties/changeover; typically three pairs per team with equal participation counts. Wide soft cloth/appropriate quick-release ties; no forced pairings or dragging.
- Round 3: Spoon & Ball Relay, around 8 minutes; one hand-held spoon/team and a ping-pong ball. Drop: stop, replace and resume from the drop location; no finger-holding the ball while moving.
- Combined scoring/transitions: about 4 minutes.
- Each round awards 5, 4, 3, 2, 1 by place. Sum round points; convert relay overall placing to championship points. Do not substitute combined race times for this system.
- Rotate seventh/eighth members across rounds; keep runner/pair counts equal between teams.

## Championship

Five championship categories, normally 5/4/3/2/1 points by placing, highest total wins. Do not add raw Borrow-a-Thing or ball counts directly to overall points. Earlier overall tie approach: most first-place finishes, then short tie-breaker. Cavalry eligibility/scoring and Tug-of-War placement ties remain unresolved; do not automatically give missing teams last place.

## Operations and notes

- Main Judge / Scorekeeper: one combined role owns final decisions, whistle, timing and all score entry. Confirm observations with the assistant and record during safe pauses while the assistant oversees play.
- Assistant Judge: one observer oversees play, calls out finish/boundary observations and confirms them with the main judge / scorer. The main judge finalizes results and scores; the assistant also prepares the next matchup.
- First-Aid: 2 volunteers, one at the kit and one covering the field. Pair them so one can escort someone while the other stays; ensure qualified coverage and emergency contacts.
- Equipment: 3 volunteers, one per game area plus one for packing; cover rope, markers, cones and the tug-of-war anchor.
- Food & Water: 2–3 volunteers, one at the cooler and one serving; the third helps with setup, bins or break cover.
- Comm: 2 volunteers, Mario and Cindy; one runs the schedule and calls teams, one handles the mic or photos and supports announcements of confirmed results.
- Support total: 9–10 across First-Aid, Equipment, Food & Water and Comm. Including the main judge / scorer and assistant judge: 11–12 total.
- First-aid notes may include voluntarily disclosed asthma, allergies, diabetes, seizure conditions, fainting, cardiovascular conditions or injuries and access to participants' own emergency medication. Keep identifiable health notes private and out of public/media exports.
- Existing items: mat, one whistle, icebox, transport cart, umbrellas, pens/markers, phones/timer and equipment bags.
- No handball, extra medium balls, long basket pole, canopy, medals or certificates. Winner coupons/gift vouchers planned.

## Shopping cart

- Shared Temu cart: https://share.temu.com/lmk1A7RfDsA
- Use this one cart link for the shopping list; it replaces the individual store links.
- The cart's contents, quantities and prices have not been verified. Keep the existing kit checklist until confirmed item details are supplied.

## First implementation pass

Inspect any existing code in the user's chosen folder first; otherwise initialise a suitable small frontend. Reproduce the reference with real components and exact schedule, then implement the draw/bracket and per-game interactions. Preserve the current design rather than redesigning it. Deliver runnable files with setup/run instructions and tested desktop/phone views. Record unresolved rules instead of silently choosing them.
