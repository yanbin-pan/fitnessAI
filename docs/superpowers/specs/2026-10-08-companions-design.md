# Nutrition Companions — Design Spec

Implementation brief for the 3D companion avatars. The reference implementation is
`2026-10-08-companions-prototype.html` (single file, Three.js r128, no build step). Open it in a
browser to see every behaviour described here. **When this spec and the prototype disagree,
the prototype wins.** Port its geometry, numbers and timing; don't redesign.

## 1. Concept

- The user picks one of eight starter companions at onboarding (more can be added later). Profiles set up
  before companions existed are asked once on Today (§7).
- The companion reflects the user's eating. It shows this mainly through posture, eyes, colour,
  motion and props. Body shape changes in **one** place only: a mild, playful rounder belly and
  cheeks in **Overfed** (see §3). The companion never gets thinner, and no other state changes its size.
- Visual language: **low-poly, faceted "origami" animals** in matte two-tone colours,
  seated on a soft plinth, with **small dark dot eyes** in the style of the original reference.
  It must sit comfortably inside the app's **neumorphic, matte UI**.

## 2. The cast

Companions are named after Italian desserts whose colours or texture match them: Tiramisù
(cocoa brown), Panna Cotta (soft and pale), Zabaione (golden custard), Cannolo (toasted shell),
Bombolone (round, sugary doughnut), Sfogliatella (golden layered stripes), Meringa (white,
fluffy) and Cantuccio (chestnut biscuit). New companions should follow the same convention.
Keep the accents (`Tiramisù`) in display names, and use plain ASCII ids in code (`tiramisu`,
`panna-cotta`, `zabaione`, `cannolo`, `bombolone`, `sfogliatella`, `meringa`, `cantuccio`).

| Name  | Animal    | Ears                                  | Muzzle                                                        | Tail                              | Signature detail                                      |
|-------|-----------|---------------------------------------|---------------------------------------------------------------|-----------------------------------|-------------------------------------------------------|
| Tiramisù | Bear cub  | Round                                 | Round, light                                                  | Stub                              | —                                                     |
| Panna Cotta | Elephant  | Big flat ears (flap)                  | 5-segment trunk + small tusks                                 | Thin with dark tuft               | Trunk curls/raises with mood; thicker legs, scale 1.1 |
| Zabaione  | Shiba Inu | Tall pointed, slightly forward-tilted | Narrow wedge snout with bridge; cream cheeks; eyebrow dots    | Curled over the back (cream inner) | White paws                                            |
| Cannolo  | Capybara  | Small, set far back                   | Big blocky muzzle, wide flat nose                             | None                              | Yuzu on head; slightly wider body, scale 1.04         |
| Bombolone | Pig      | Soft triangles folding forward        | Flat round snout disc with two nostrils                       | Small corkscrew                   | Dark hooves                                           |
| Sfogliatella | Tiger | Round                                 | Round, white                                                  | Long, with dark rings and tip     | Dark stripes on forehead, cheeks and body sides; white cheek ruffs |
| Meringa  | Sheep     | Sticking out sideways                 | Round, cream                                                  | Woolly puff                       | Fluffy wool puffs over body and haunches, curly tuft on head; dark grey legs |
| Cantuccio | Horse    | Tall pointed (scaled 0.75)            | Long muzzle angled down, nostrils; white blaze down the face  | Long dark tail                    | Dark mane along head and neck, forelock               |

All four share **one seated body plan**: tapered 7-sided torso with a darker shaded side,
light chest bib, two haunches, two front legs with paws, and a head on top. Only head, ears,
muzzle, tail and props differ. **Don't give them species-specific chunky bodies.** That was
tried and rejected.

### Palette (base colours, before mood adjustment)

| Companion | Fur       | Fur (shade) | Light     | Dark      |
|-----------|-----------|-------------|-----------|-----------|
| Tiramisù     | `#A96B42` | `#945A35`   | `#D9B48C` | `#4E3020` |
| Panna Cotta     | `#A3A8BA` | `#8E93A6`   | `#C9CDD9` | `#6E7386` |
| Zabaione      | `#D9884A` | `#C27538`   | `#F3E3CA` | `#3A2E2A` |
| Cannolo      | `#B08360` | `#9A6F4F`   | `#C9A280` | `#4A3326` |
| Bombolone    | `#E9A3A0` | `#D98B89`   | `#F5C9C2` | `#9E5957` |
| Sfogliatella | `#E8873A` | `#D4752C`   | `#F6E7D0` | `#2E2523` (stripes `#3A2A24`) |
| Meringa      | `#EADFCF` | `#DCCFBC`   | `#F2EADF` | `#4F4744` (wool `#F7F4EE`, legs `#5E5652`) |
| Cantuccio    | `#9A5B36` | `#86492A`   | `#B5774E` | `#2E1F17` (mane `#3E2A1E`, blaze `#F3EDE4`) |

Fixed colours: eyes `#1F1A18`, mouth `#3A2A26`, tongue `#E9787A`, blush `#EE8F86`,
yuzu `#E9A84C` with leaf `#7FA36A`.

### Faceted look

- Materials: matte (`roughness ≈ 0.9`, `metalness 0`), **flat shading**.
- Low-detail geometry (icosahedron detail 0–1, 5–7-sided cylinders and cones).
- Each vertex is nudged by a small deterministic offset (`facet()` in the prototype, about 0.02–0.05
  units, keyed by position so shared vertices stay welded). This creates the hand-folded look.
- Two-tone: left/right halves alternate fur / fur-shade colours.

## 3. Mood model

There are five moods, worked out on the server from the **rolling 7-day average** of eaten kcal against each day's
adjusted target (`shared/src/companions.ts`). The companion never moves with a single day.

- **The week.** The 7 complete days before today. Today is still in progress, so it is left out, as in the calendar.
  Only days with food logged count: a day someone forgot to log is not a day they ate nothing. The average is eaten kcal
  over those days against their targets over the same days.
- **Inactive:** nothing logged in the 7 days ending today. Logging anything today wakes the companion straight away
  (Okay, with nothing to judge yet).
- **Sluggish:** the week's average is more than **15 %** under target.
- **Overfed:** the week's average is more than **15 %** over target.
- **Okay:** within 15 % either way.
- **Thriving:** the week has been Okay on each of the last **14** days (the week ending yesterday, the week ending the
  day before, and so on). A week counts towards that streak only with food logged on at least **4** of its 7 days, so
  someone who stops logging stops thriving.

Precedence: Inactive > Overfed / Sluggish > Thriving > Okay. The direction is the same for every body goal: the target
already carries the goal.

The avatar is still driven by the prototype's **nutrition score (0–100)** and two flags; the app maps each mood to the
prototype's presets: Sluggish 20, Okay 55, Thriving 95, Inactive and Overfed as flags (precedence `inactive` > `overfed`
> score).

The score eases towards its target at about 3×/second, and each flag fades in and out over about
0.4 s, so every change blends smoothly. These internal values are derived each frame:

```
sleep  = eased 0 → 1 when Inactive is on
vAwake = lerp(0.52, 1, clamp((score - 10) / 45, 0, 1))   // awake pose: droopy → content (reached at 55)
v      = lerp(vAwake, 0, sleep)                          // pose: 0 = asleep, 1 = content
over   = eased 0 → 1 when Overfed is on (and not Inactive)
v      = lerp(v, 0.7, over)                              // overfed pose: awake but heavy and droopy
u      = (1 - smoothstep(22, 50, score)) * (1 - sleep) * (1 - over)   // under-eating (awake only)
x      = smoothstep(70, 92, score) * (1 - sleep) * (1 - over)         // extra joy for Thriving
```

| Mood     | Trigger           | What the user sees |
|----------|-------------------|--------------------|
| Inactive | Nothing logged for 7 days (flag) | **Asleep.** Slumped forward, sitting lower, ears drooping, eyes shut, frown, washed-out colour, slow breathing, floating "z" sprites |
| Sluggish | 7-day average > 15 % under target (score 20) | **Awake but run-down and hungry.** Droopy posture, tired eyes with shadows underneath, wobbly uneasy mouth, pale drained colour, sweat drop, tummy grumbles, keeps glancing at an **empty food bowl** |
| Okay     | 7-day average within 15 % (score 55) | **Calm and content.** Sitting tall, ears up, round blinking eyes, small smile, gentle head tilt, gentle tail wag, full colour |
| Thriving | Okay for 14 days in a row (score 95) | **Ecstatic and energetic.** Everything in Okay, plus continuous hops, happy `^ ^` eyes, open smile, rosier cheeks, energy FX |
| Overfed  | 7-day average > 15 % over target (flag) | **Stuffed and uncomfortable.** Slightly rounder belly and cheeks, slumped and droopy, tired heavy eyes, uneasy mouth, sweat drop, burps, winces with an "oof…", crumbs on the face, an **overflowing bowl** of pastries with a cannolo rolled out |

Sluggish must read as "not being fed well" while the companion is clearly awake. **It must not
change body size or weight.** Hunger is shown only through expression, colour, props and behaviour.

Overfed should read as "I've overdone it": tired and a bit uncomfortable, so it doesn't reward
overeating, but never sad, ashamed or mocking. Keep the chubbiness gentle (caps below). The empty bowl (under-eating) and the
overflowing bowl (overeating) mirror each other on purpose.

### Driven by `v` (pose)

- Body: leans forward 0.32 rad → upright −0.04; vertical squash 0.88 → 1.0; sinks 0.08.
- Head: pitches down 0.42 rad → 0.
- Ears: tall ears droop about 1.15 rad outward; round ears rotate 0.7 rad; elephant ears hang and stop flapping.
- Eyes: dot height scales 0.22 → 1.0 (shut → round).
- Mouth: frown when `v < 0.45` (Inactive), otherwise a smile (see `u` for Sluggish).
- Breathing: slow and deep at low `v`, quick and shallow when content.
- Colour: saturation ×(0.15 + 0.85v); slight lightening when low (desaturated, not darkened).
- Cannolo's yuzu sits on his head when awake and has rolled onto the plinth when Inactive.
- "z" sprites show only when Inactive (driven by `sleep`).

### Driven by `u` (Sluggish: awake but underfed)

- **Eyes:** open but tired. Dot height ×(1 − 0.32u), sitting slightly lower, with soft
  purple-grey shadows underneath (`#5E5470`, up to 55% opacity).
- **Mouth:** a wobbly, uneasy wavy line replaces the smile when `u > 0.35`.
- **Colour pallor:** saturation ×(1 − 0.5u), lightness +0.05u, and a slight hue nudge towards a
  sickly yellow-green. Drained, never darker.
- **Blush** fades out.
- **Sweat drop:** a small light-blue drop (`#9FD3EA`) slides down beside the head on a loop.
- **Tummy grumble:** about every 4 s, a 0.4 s quick shiver of the body plus a small grey
  squiggle by the belly.
- **Sighs:** slower, deeper breathing.
- **Empty bowl:** a low-poly ceramic bowl (`#C9CDD6`) with a few crumbs appears on the plinth
  in front of the companion. The companion periodically turns and looks down at it.
- Cannolo's yuzu is gone completely: nothing to eat.
- No hops, no FX, no "z" sprites.

### Driven by `x` (Thriving joy)

- **Hop loop:** 0.8 cycles/s, a squash before take-off (up to 14%), jump height up to 0.3 units.
  The contact shadow shrinks and fades in the air.
- **Dance:** body and head sway side to side about 4.2 rad/s.
- **Eyes:** mostly happy `^ ^` arcs (about 65% of the time), with brief open-eye moments.
- **Mouth:** open smile (half disc) with tongue, gently pulsing.
- **Blush** opacity 0.35 → 0.9; colours slightly richer.
- Ears twitch; tail wags fast (up to 13 rad/s); Panna Cotta raises and curls his trunk and flaps
  faster; Cannolo's yuzu bounces and spins on his head.

### Always on

- Blink every 2.2–5.2 s (randomised per companion, skipped when Inactive).
- Idle body sway of the whole figure.
- **Tap to pet:** a tapped companion does a 1.1 s happy hop with `^ ^` eyes and an open smile.
  This works in every mood except Inactive, so a hungry companion still cheers up briefly when touched.

### Driven by `over` (Overfed: stuffed and uncomfortable)

Overfed must **not** look like a reward. It reads as "ugh, I ate too much": tired, heavy and a bit
queasy, never sad or ashamed, and never cheerful.

- **Body:** torso width ×(1 + 0.18·over) and depth ×(1 + 0.22·over); chest bib ×(1 + 0.2 / 0.3);
  a light belly bulge (icosahedron, r 0.4) grows in front; haunches ×(1 + 0.14·over) and spread
  8% outward. **These are the maximums. Don't go chubbier.**
- **Cheeks:** fur-coloured puffs grow on both sides of the face.
- **Pose:** droopy (pose `v` pulled to 0.7), slumped back 0.16 rad, ears slightly down,
  **no tail wag**.
- **Eyes:** tired and heavy-lidded (×0.4 height), soft shadows underneath. **No happy `^ ^` squint.**
- **Mouth:** the wobbly, uneasy line, not a smile.
- **Breathing:** slow, heavy belly breaths.
- **Burp:** about every 5 s, a 0.45 s burp. Mouth becomes a small "o", head tips back, belly jiggles
  6%, and a grey-outlined bubble floats up.
- **"Oof…":** about every 7 s, a wince. Eyes squeeze nearly shut, the body hunches forward 0.14 rad,
  and an italic grey "oof…" floats beside the head.
- **Sweat drop** slides down beside the head (same as Sluggish).
- **Colour:** a slight queasy pallor (30% of the Sluggish pallor); blush toned down.
- **Props:** an overflowing bowl (same bowl as Sluggish) piled with pastries and a strawberry, plus a
  cannolo that has rolled out of it. A few crumbs sit around the mouth.
- No hops, no energy FX, no empty bowl.

## 4. Thriving energy FX (sporty, not cute)

**Don't use hearts.** Use energy effects, with opacity scaled by `x` (and by the tap reaction):

1. **Sparkles:** 4 four-pointed stars (gold `#F2C14E` and white) around the head that twinkle in size and spin.
2. **Energy bolts:** a yellow lightning bolt (`#F5C33B`, outline `#D9822B`) beside each shoulder that pops on every jump.
3. **Speed streaks:** 4 thin teal streaks (`rgb(120,214,226)`) rushing upward behind the body.
4. **Landing ring:** a gold ring on the plinth that expands (0.8× → 2.1×) and fades each time the companion lands.

## 5. Interaction and staging

- Companion sits on a soft round plinth that uses the UI's neumorphic surface colour (`--plinth`),
  with a blurred contact shadow.
- Drag horizontally to rotate. Tap to pet.
- Camera: about 28° FOV, slightly above, looking at chest height.
- Respect `prefers-reduced-motion`: hold poses, no hops or FX motion, keep the state readable.

## 6. Implementation notes

- **Rendering:** the prototype uses Three.js. In a React or React Native app, port to
  `@react-three/fiber` (web) or `expo-gl` / `react-native-wgpu` (native). Use the prototype's
  `buildAnimal(cfg)` as the source of truth for geometry, and its `update(t, v, x, ctx)` for animation.
- **Data contract:** the avatar component takes `companion`, `mood` and the framing; `moodInput()` turns the mood into
  `score (0–100)`, `inactive` and `overfed` for the stage, which owns its own easing. Precedence: `inactive` > `overfed`
  > score. Every day view carries `companion: { mood, avg_kcal, avg_target_kcal, days_logged, okay_streak }`, as of
  today whichever day is open. The profile carries `companion` (an id, default `zabaione`) and `companion_prompt`.
- **Port:** current three.js with colour management off, linear output and the lights scaled by π, which is what r128's
  legacy light units did, so the colours and lighting match the prototype. three.js loads in its own chunk with the first
  companion shown; without WebGL the app shows a disc in the companion's colours.
- **Structure:** one shared body/animation module plus a per-species config object
  (ears, muzzle, tail, palette, props). Adding a fifth companion should mean adding one config.
- **Production art path, later:** these shapes can be rebuilt in Blender with two blend poses
  (sluggish / content) plus a joy layer, exported as glTF. Keep the same `v` / `x` mood model
  so the code doesn't change.
- **Performance:** about 60 meshes per companion, no textures except tiny canvas sprites.
  Fine on mobile. Render only the selected companion in the app.

## 7. In the app

- **Placement:** top left of the day bar, opposite the calendar and the same size: a live, miniature companion at
  30 frames a second, in its current mood.
- **Bubble:** tapping it grows a card out of the corner, under the day bar (not the whole screen): the companion large on
  its plinth (drag to turn, tap to pet), its name and animal, the mood, one line of why, the 7-day average against the
  target, progress towards Thriving while Okay, and a reminder that it follows the week, not the day. Escape, the close
  button or the scrim close it. The small one holds still while the bubble is open.
- **Choosing:** Settings has the picker (eight tiles with a still of each), which is also the setup form for a new
  profile. A profile set up before companions existed gets a one-time card on Today, after the name question:
  Choose or Not now (keeps Zabaione) settle it for good.
- **The coach takes its name.** The companion is who the person chats with: the coach's instructions, the weekly
  analysis and every place the app names the coach say the companion's name. Zabaione stays the app's name and the
  default companion.

## 8. Acceptance checklist

- [ ] All eight companions match the prototype's silhouette, colours and faceted look side by side.
- [ ] Inactive, score 20, 55, 95 and Overfed each look like their mood in the table above.
- [ ] Overfed reads as stuffed and tired (no happy eyes, no wag, "oof…" winces), not as a reward, and the body change stays within the stated caps.
- [ ] Sluggish clearly reads as awake but hungry or unwell (open tired eyes, empty bowl), not asleep.
- [ ] Dragging the score from 0 to 100 blends smoothly, with no popping except deliberate toggles (mouth, eye style).
- [ ] Thriving uses sparkles, bolts, streaks and a landing ring, with no hearts.
- [ ] No body size change in any state except the capped Overfed puff; nothing ever gets thinner.
- [ ] Tap-to-pet works; reduced-motion mode holds static poses.
- [ ] Runs at 60 fps on a mid-range phone with one companion on screen.
