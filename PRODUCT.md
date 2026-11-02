# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A React web app installed on the phone (PWA). An App Store version wrapped with Capacitor is planned for later. No native UI is planned.

## Users

- **Today:** Bin and an invite-only circle of family and friends, on the home Raspberry Pi deployment.
- **Public launch:** adults who want to eat and train better and who also care about long-term health. A typical example is a parent who got blood test results back and has no idea what to change at dinner. Their job is to understand and steer their daily food and exercise without counting or weighing, and to connect it to their health records.

## Product Purpose

Zabaione is a food and fitness coach you talk to. You tell it what you ate or did in one sentence, or send a photo of the plate. It logs the food, portions and effort, keeps daily targets, and coaches you with the context of your whole week. That context includes training, conditions, medications and blood test results. Success means people keep using it week after week (retention first, then a paid launch) because it feels like a coach who knows them.

## Positioning

A coach that remembers. Photo-only trackers like Cal AI log a plate and forget it. Zabaione holds the whole context: food across days, exercise, and health records such as blood tests. It talks to you about them in plain words, in your language. A companion pet shows how your week is going without numbers.

## Operating Context

- The chat sits at the centre of the Today screen. Logging happens by talking or by photo, never by forms.
- The day's macros and calories must be visible immediately at the top of Today.
- Weekly insights are written on Mondays once 7 days are logged.
- The Health tab keeps conditions, injuries, medications, allergies and records. Documents such as blood tests are read from photos, and nothing reaches the profile until the person taps Add.
- The app is used on the phone throughout the day, in short moments around meals and workouts.

## Capabilities and Constraints

- Seven languages: English, Italian, Chinese (Simplified), Lithuanian, French, German and Spanish. The coach replies in the app language, and logged item names always use the app language.
- Eight companions, each a low-poly 3D animal named after an Italian dessert: Zabaione (Shiba Inu), Tiramisù (bear cub), Panna Cotta (elephant), Cannolo (capybara), Bombolone (pig), Sfogliatella (tiger), Meringa (sheep) and Cantuccio (horse). Their mood follows nutrition and activity. They are drawn with three.js in `web/src/companions/`.
- Health: the app gives coaching and explanations tied to diet and training, **never a diagnosis**. (App Store 1.4.1 and EU medical-device risk apply.)
- Cost-conscious: the coach chat runs on a small, cheap model, and the weekly insights run on a larger one.
- Undecided: target segment details, launch timing, pricing (planned: in-app purchase after a free trial) and marketing budget.

## Brand Commitments

- Name: Zabaione. The companion avatar is a Shiba, and every companion is named after an Italian dessert. Public email: hello@zabaione.app. Socials: @zabaioneapp.
- The app keeps its current neumorphic style, adding only touches of colour. It must not look like Apple Health or Apple Fitness.
- Voice: warm, plain, like a friend who pays attention. No lecturing. Companion reactions stay rare and natural.
- The brand kit (logos, palette, Fraunces + Inter) is in the project files under `marketing/brand/`.

## Evidence on Hand

- A real working app with real screens. The 3D companions can be rendered live from the app code.
- The founder story: Bin's parents' blood results.
- Brand kit assets and 3D-render marketing stills.
- **None yet:** testimonials, user counts, press, reviews, benchmarks or pricing. Do not fabricate any of these.

## Product Principles

1. Talk, don't log: every input should work as a sentence or a photo.
2. Remember across days: advice reflects the week the person is actually having, not just today.
3. Explain, never diagnose: health records inform coaching in plain words.
4. Show progress through the companion before numbers, while keeping the key numbers one glance away.
5. Spend tokens carefully: anything that can be computed in code is.

## Accessibility & Inclusion

- Seven languages, with i18n typed so missing strings fail the build.
- Respect `prefers-reduced-motion`: companions and effects settle to still frames.
- Light and dark themes follow the phone or the choice made in Settings.
