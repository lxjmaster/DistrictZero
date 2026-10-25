# DistrictZero Project Guidance

## Project Identity

- Canonical project and English display name: DistrictZero.
- Chinese game identity: 第0街区. Preserve the Arabic digit 0 in Chinese titles and address labels.
- Repository: https://github.com/lxjmaster/DistrictZero.
- Genre: contemporary supernatural fiction, text-based management, and idle progression.
- The central theme is building a future from an unregistered beginning. Zero may express despair, a first existence, or open possibility.

## Current Authorization Boundary

The bootstrap task is complete. On 2026-10-14 the user invoked the handoff prompt and authorized implementation and verification of the complete V0.1 playable game through local delivery.

On 2026-10-14 the user additionally authorized adding GitHub Actions and publishing V0.1 to GitHub Pages. This delivery includes committing and pushing the implemented game and resource-capacity fix to master, enabling Pages, deploying, and verifying the public site. Later roadmap implementation is outside this scope. Subsequent user instructions may change this boundary. Do not request repeated approval for an unchanged authorized outcome.

The user has now requested further content and a roadmap audit. This authorizes
local implementation and verification of V0.2, following docs/V0.2_SPEC.md.
That local delivery and its review fixes are complete. On 2026-10-15 the user
additionally authorized committing and pushing the complete V0.2 and review
fixes to master, publishing through the existing GitHub Pages workflow, and
verifying the public site. V0.3–V0.6 remain subsequent work. Do not request
repeated approval for this unchanged publishing outcome.

The user subsequently authorized implementing V0.3 after the roadmap audit.
Implement and verify the complete local third chapter in docs/V0.3_SPEC.md,
including migration from V0.1/V0.2. The previous publishing task is complete;
V0.4–V0.6 remain subsequent work.

The V0.3 local delivery and review fixes are complete. On 2026-10-15 the user
additionally authorized committing and pushing the complete V0.3 and review
fixes to master, publishing through the existing GitHub Pages workflow,
verifying the public site, and updating the repository documentation with the
deployed Pages URL. Do not request repeated approval for this unchanged outcome.

V0.3 is now published at https://lxjmaster.github.io/DistrictZero/; see
docs/VERIFICATION.md for the release and public-site checks. Further pushes to
master also deploy publicly. V0.4–V0.6 remain subsequent work.

The user subsequently authorized implementing the corrected experience expansion
without changing its fixed goals. The complete first batch, V0.3.1, is now
implemented and verified locally against docs/V0.3.1_SPEC.md. This task includes
assembly, the four L01 nodes and both branches, both workbench modifications,
optional prefabrication, state-based streetscape, mobile shortcuts, reports,
and schema 1/2/3 migration. It does not authorize a new commit, push, or public
deployment under that earlier task. On 2026-10-15 the user additionally authorized
committing and pushing the reviewed V0.3.1 implementation, including its review
fixes, to master, with the existing automatic Pages deployment effect, followed
by local implementation and verification of V0.3.2. The latest explicit instruction
authorizes starting the second batch before independent human feedback has been
sampled; record that feedback as unperformed and do not claim its experience
criteria passed. The user subsequently authorized committing, pushing and publishing
V0.3.2, then starting V0.3.3 after that publication succeeds. V0.3.1 and its publication documentation are now pushed through
`ac72f1e`; both Pages workflows succeeded. V0.3.2 follows
`docs/V0.3.2_SPEC.md`. Do not change fixed values to make tests pass or silently reduce
acceptance scope.

V0.3.2 is published at the Pages URL above on 2026-10-16: game commit
`c3a8e38`, test-worker communication fix `eac286e`, successful Pages run
38780085842. The 137 engine/storage tests, 36-test browser baseline plus the
7-test neighborhood regression, type checking and production build passed.
Public assets match the build; isolated desktop/mobile checks verified schema 5 /
balance 0.3.2 new saves, genuine schema 4 migration, recovery copy and reopening.
See docs/VERIFICATION.md and docs/PLAYTEST.md for measured routes and unsampled
human feedback. The user has authorized local implementation and verification of
V0.3.3 after publication, against the fixed third-batch scope and section 19 of
docs/EXPERIENCE_EXPANSION_PLAN.md. This continuation does not authorize publishing
V0.3.3. Preserve the pre-existing 127.0.0.1:5173 development server; the task-owned
4173 preview server was stopped.

V0.3.3 is now implemented and verified locally on 2026-10-16 against
docs/V0.3.3_SPEC.md: after three P2 review fixes, 182 engine/storage tests, all 44
browser tests, type checking and production build passed. The initial delivery
also passed an isolated /DistrictZero/ preview. Desktop/mobile
routes completed all fixed third-batch content. See docs/VERIFICATION.md and
docs/PLAYTEST.md for costs, migrations and unsampled human feedback. The user
subsequently authorized committing and pushing V0.3.3 and all three review fixes
to master, publishing through the existing Pages workflow, verifying the public
site, and synchronizing release documentation. Continue this unchanged outcome
without repeated approval. V0.3.3 is now published: game commit `c9efc0f`, version
display fix `db4e452`, CI scheduling fix `0d6caf7`, successful Pages run
38839431982. Public HTML/JS/CSS/favicon match the local production build.
Isolated desktop/mobile checks verified schema 6 / balance 0.3.3 new saves,
genuine schema 5 migration and recovery, completed-content import and reopening.
The CI job runs all 182 engine/storage tests serially by file to avoid competing
full-week simulations. The full-week neighborhood equivalence case has a 180s
CI timeout after a serial runner took 69s; its local timeout remains 60s, with
all assertions and simulated durations preserved. All 44 browser tests remain
verified locally. See the
V0.3.3 publication record in docs/VERIFICATION.md. This completed publishing task
does not authorize V0.4 development. Saved zero contract targets remain zero;
new route defaults are initialized at opening, and in-transit P11 proof must
serve current demand. Existing supplies for one producible, returnable package
can prove P11 without filling the configured buffer; demand, pickup, space,
vehicle availability, future fee and reserves still apply.
The review-fix run found no existing 5173 listener; its
task-owned browser-test service stopped after verification. Ports 5173 and 4173
are now stopped.

On 2026-10-23 the user authorized complete local V0.4 implementation and
verification by continuing the roadmap work. Follow docs/V0.4_SPEC.md, including
P12, both outposts, all six projects, both proofs and knowledge rewards, L04,
genuine schemas 1-6 migration and B01-B12. The local build uses schema 7 /
balance 0.4.0. The public site remains V0.3.3. This work does not authorize a
commit, push, public deployment, or V0.5/V0.6 development. Human feedback remains
unsampled; do not represent automated routes as human experience acceptance.
The complete local B01-B12 delivery is now verified: 238 distinct unit/storage
tests (233 full-run baseline plus five added scoped cases), 46 distinct browser
tests, type checking, production build and isolated /DistrictZero/ preview.
See docs/VERIFICATION.md and docs/PLAYTEST.md for evidence, costs and limits.
Task-owned services on ports 5173 and 4173 are stopped; fixtures, build output
and reproducible verification artifacts are retained.

After the V0.4 local delivery and its two UI review fixes, the user requested
the next roadmap stage on 2026-10-23. This authorizes complete local V0.5
implementation and verification against docs/V0.5_SPEC.md and K01-K12.
Use schema 8 / balance 0.5.0, preserving genuine schemas 1-7, the V0.4 old
offline interval, and all existing content. This task does not authorize a
commit, push, public deployment, V0.6, or contacting human playtesters.
The public site remains V0.3.3; human feedback remains unsampled.

The complete local V0.5 delivery is verified against K01-K12: 296 distinct
unit/storage tests (261 baseline/save cases plus 35 focused calendar cases,
with scoped reruns recorded separately), all 48 browser tests, type checking,
production build and isolated /DistrictZero/ preview passed. Genuine schemas
1-7 and the original V0.4 offline reference are retained. See
docs/VERIFICATION.md and docs/PLAYTEST.md for acceptance, measured costs and
unsampled human feedback. Task-owned services on 5173/4173 are stopped.
This completed local task does not authorize publishing V0.4/V0.5 or starting
V0.6; source, fixtures, build and verification evidence remain in the workspace.

On 2026-10-23, after the V0.5 review fix for reservation-source labels, the user
explicitly requested publication. This authorizes committing and pushing the
complete V0.4/V0.5 implementation and review fixes to master, publishing through
the existing GitHub Pages workflow, verifying the public site, and synchronizing
release documentation. Continue this unchanged outcome without repeated approval.
Do not claim publication before the matching deployment and public checks pass.
V0.6 and human-playtester contact remain outside this publishing task.

V0.5, including the complete V0.4 outposts and both versions' review fixes, is
now published at https://lxjmaster.github.io/DistrictZero/ on 2026-10-23.
Game commit `3c094d7` passed Pages run 39943605835: all 296 unit/storage tests
in one serial run, type checking, production build and deployment succeeded.
Public HTML/JS/CSS/favicon match the reviewed local build byte-for-byte.
Four isolated browser scenarios verified desktop/mobile schema 8 / balance 0.5.0
new saves, genuine schemas 6/7 migration and old recovery copies, complete and
prepared schema 8 imports/reopening, 320px controls and separate shipment/calendar
reservation labels. Public migrations used zero offline elapsed time; long
offline and schemas 1-7 coverage remain in the recorded engine/local acceptance.
See docs/VERIFICATION.md and docs/PLAYTEST.md for evidence and limits. Human
feedback remains unsampled; V0.6 is not authorized. No local service was started
for publication, and the isolated verification browser is closed.

On 2026-10-25 the user requested continuing in the order of docs/NEXT_STEPS.md.
This authorizes the toolchain maintenance and complete local V0.6 implementation
and verification after its fixed specification and genuine V0.5 evidence are
prepared. Track actual work in issues/V0.6.md. This local continuation does not
authorize committing, pushing, publishing or contacting human playtesters.
The public release remains V0.5 until a later publishing instruction.

The complete local V0.6 delivery is now verified against docs/V0.6_SPEC.md and
G01-G12: schema 9 / balance 0.6.0, three covenants and every dual combination,
P17-P19, L06-1 through L06-4, genuine schemas 1-8 migration and released V0.5
offline references. All 330 distinct unit/storage cases and 51 distinct browser
scenarios passed, including scoped reruns; type checking, production build and
isolated preview passed. Exact run boundaries and review fixes are recorded in
docs/VERIFICATION.md. Both task-owned ports 5173/4173 are stopped. Sources,
fixtures, build and reproducible evidence remain local. Do not commit, push or
publish without a subsequent publishing instruction. Human feedback remains
unsampled; docs/HUMAN_PLAYTEST.md now includes the later-chapter appendix.

On 2026-10-25, after the local V0.6 delivery, the user requested continuing the
explicitly identified next step of publication. This authorizes committing and
pushing the complete V0.6 implementation, toolchain maintenance and verified
fixes to master, publishing through the existing GitHub Pages workflow,
verifying the public site, and synchronizing publication documentation.
Continue this unchanged outcome without repeated approval. Do not claim the
release is public until its deployment and public checks pass. New features
and contacting human playtesters remain outside this publishing task.

V0.6 is now published at https://lxjmaster.github.io/DistrictZero/ on 2026-10-25:
game commit `bd59528`, successful Pages run 40165093552. The cloud run passed
all 330 unit/storage tests in one serial run, type checking, production build
and deployment, with zero dependency audit findings. Public HTML/JS/CSS/favicon
match the local build byte-for-byte. Six isolated desktop/320px mobile scenarios
passed: schema 9 / balance 0.6.0 new saves; genuine schema 8 prepared/in-transit
migration, original recovery copy and restoration; complete chapter import,
reopening, invalid provenance rejection, actual dual upkeep and free pause.
Public migration checks use zero offline elapsed time; long offline and genuine
schemas 1-8 remain covered by the recorded local acceptance. Evidence and limits
are in docs/VERIFICATION.md. Human feedback remains unsampled. No local service
was started for publication; the isolated verification browser is closed.
This completed publication does not authorize new gameplay or human contact.

After publication on 2026-10-25 the user requested continued technical work and
explicitly deferred human playtesting. The local follow-up verifies Firefox and
Playwright WebKit, then optimizes long-settlement responsiveness. It changes only
the controller batch cap from 10,000 to 1,000 simulated seconds, based on measured
production-build comparisons. Per-second economy, captured-time migration,
whole-interval legacy rules, interrupted retry and first single save remain
unchanged. Local verification and measurements are in docs/VERIFICATION.md.
At that local checkpoint the maintenance was not committed or published, and
the public V0.6 still had the old batch cap. The compatibility configuration
and documentation were retained for the subsequent authorized publication.
Human sampling stays deferred.

On 2026-10-25 the user continued the explicitly identified next delivery step:
review, commit and publish the local compatibility checks and long-settlement
responsiveness maintenance, then verify the public deployment and synchronize
its documentation. This authorizes committing and pushing this maintenance and
necessary review fixes to master with the existing Pages deployment effect.
The review found no blocking defect. Reuse the recorded local verification;
verify the matching cloud run and deployed artifacts before claiming publication.
Human playtesting remains deferred; new gameplay is outside this outcome.

The maintenance is now published on 2026-10-25: commit `3625b6e`, successful
Pages run 40168925170. The cloud passed all 330 unit/storage tests, type checking,
build and deployment. Public HTML/JS/CSS/favicon match dist byte-for-byte, with
`index-DoQiostp.js`. Six isolated desktop/320px public scenarios passed new saves,
genuine schema 8 migration/recovery, complete import/reopening, provenance
rejection, dual upkeep and pause. Four further public checks passed new saves
and 24-hour complete-state/report equivalence; no >=50ms native long task was
observed on this host. This is not real-phone or human-experience acceptance.
Schema 9 / balance 0.6.0 and all economic rules remain unchanged. Browsers are
closed and no local service was started. Evidence is retained under
test-results/v06-maintenance-publication/ and docs/VERIFICATION.md. Publication
documentation follows through the same workflow; verify its final run before
reporting completion. No new gameplay or human contact is authorized here.

## Authoritative Design

Read these documents before implementation:

1. docs/PRODUCT_SPEC.md
2. docs/TECHNICAL_PLAN.md

For V0.2 changes, also read docs/V0.2_SPEC.md and map verification to C01–C08.
For V0.3 changes, read docs/V0.3_SPEC.md and map verification to N01–N08.
For V0.3.1 changes, read docs/V0.3.1_SPEC.md and the review dispositions in
section 19 of docs/EXPERIENCE_EXPANSION_PLAN.md. The batch specification takes
precedence over older candidate rules in the expansion proposal. Verify
UX01–UX08 and UX21 alongside the original FR/C/N regressions.
For V0.3.2 changes, read docs/V0.3.2_SPEC.md. Verify UX09–UX13 and the
shared UX19/UX20 boundaries, while retaining the original regressions.
For V0.3.3 changes, read docs/V0.3.3_SPEC.md and section 19 of the expansion
plan. Verify UX14–UX20, all five genuine migrations, old-rule offline settlement,
whole-load reservations, vehicle snapshots and the complete two-device routes.
For V0.4 changes, read docs/V0.4_SPEC.md and verify B01-B12 alongside the original
regressions. Preserve its fixed costs, scoped queue timing, support limits and
two-device routes; do not change values to make a test pass.
For V0.5 changes, read docs/V0.5_SPEC.md and verify K01-K12 alongside all prior
regressions. Preserve fixed costs, 600-second rounds, stored-time conservation,
finite orders and calibration, whole-batch input/output holds, and genuine
schemas 1-7 migration. Calendar acceleration advances only the selected
external node through the shared production function, never the world clock.
For V0.6 changes, read docs/V0.6_SPEC.md and verify G01-G12 alongside prior
regressions. Preserve its fixed costs, the one/two-covenant limit, atomic group
upkeep before generation, manual confirmation and genuine schemas 1-8 sources.
Do not reinterpret existing shipment snapshots or prepared calendar holds.

docs/HANDOFF_PROMPT.md records context for resuming work; it is not an automatic trigger to start implementation when encountered during initialization.

User instructions override design assumptions. Preserve unrelated or concurrent changes. Update the relevant specification when an authorized material design decision changes.

## Implementation Baseline

- Target a single-player browser game in Simplified Chinese, with desktop and mobile layouts.
- Use the established TypeScript, React, Vite, plain CSS, Vitest, and Playwright stack. Dependencies are pinned in package.json and package-lock.json; check environment compatibility before changing them.
- Keep the simulation independent from UI rendering, browser storage, and wall-clock access.
- Store content and balance values as explicit configuration.
- Use stable IDs, versioned saves, and one simulation model for online and offline time.
- Treat the initial numerical values as playtest candidates.
- Implement V0.1 before introducing later-city, calendar, or covenant systems.

The application, package manifest, and tests now exist. See docs/VERIFICATION.md and docs/PLAYTEST.md for completed checks and their limits. docs/HANDOFF_PROMPT.md preserves the historical initialization context.

## Local Commands and Structure

- npm ci: install the locked dependency set.
- npm run dev: local development at http://127.0.0.1:5173; strict port, loopback only.
- npm run typecheck: TypeScript checking.
- npm run test: deterministic engine and storage tests.
- npx playwright install chromium: install the browser used by the test suite.
- npm run test:e2e: browser acceptance, with isolated contexts and a controlled clock.
- npm run build: typecheck and build to dist/.
- npm run preview: local build preview at http://127.0.0.1:4173/DistrictZero/.

Production builds use /DistrictZero/ as their base path; the development server uses /. The deploy-pages.yml workflow builds and publishes dist/ after pushes to master or a manual workflow dispatch. GitHub Pages must use the GitHub Actions source. Pushes to master therefore have a public deployment effect; only push within the user's authorized scope.

src/game contains configuration, simulation, and save validation. src/app contains time, persistence, and Web Locks adapters. src/ui contains the Chinese interface. Keep all production rules in the simulation; browser tests may accelerate time but must not introduce alternate economy rules.

Save keys are districtzero.save.v1 and districtzero.save.backup.v1. Origin changes, including a different port, use different browser storage. Preserve user saves; reset only isolated test data or through an explicitly confirmed game reset.

Published V0.3.2 uses schema 5 / balance 0.3.2, with genuine schema 1/2/3/4
migration. Historical V0.3.1 saves use schema 4 and balance 0.3.1, with explicit migration from
schema 1 / balance 0.1.0, schema 2 / balance 0.2.0, and schema 3 / balance 0.3.0.
V0.3.1 was published on 2026-10-15 at the Pages URL above. Historical V0.3 uses schema 3. Keep storage keys and writer lock stable. District resources
and projects are shared; facilities, residents, jobs, lighting, and public
equipment belong to their district. Maintenance is repeatable and uses a separate
completion counter. Keep the genuine V0.1/V0.2 migration fixtures and regressions valid.
External nodes have independent inventories. Cargo belongs to its shipment until
whole-load delivery; full destinations retain cargo and occupied vehicles.
Exports/imports have separate ledger entries and imports do not increase earned
production/reward totals. External workers retain home beds and cannot overlap
local jobs or relocation. Route maintenance shares the existing work queue.

src/game/experience.ts holds assembly, story, modification, and prefabrication
configuration. Components stay in the home inventory and are excluded from
existing city recipes/cargo. Repair and assembly share workbench slots. Assembly
uses a city-wide inventory target and input reserves; it replenishes after use
while enabled. New saves and migrations start with assembly disabled. Projects
retain their selected prefab count through waiting, reservation, pause, cancel,
and save round-trips. Optional payments use fulfillment; dismantling refunds do
not increase earned totals. Workbench removal clears the active modification
and retains ownership for rebuilding.

src/game/neighborhood.ts holds explicit commissions, field sites, mailbox tools,
and delegation rules. Field supplies use fieldReserved, rewards use rewards,
optional deliveries use fulfillment, and actual recalls use refunds. Held supplies
and pending refund packages conserve separately; pending rewards are not inventory.
Only one field resident may be away globally, in addition to route staff; both
occupancies apply to assignment, relocation, templates, and save validation.
Delegation executes at most one explicitly confirmed stage per second and never
accepts a successor. Old queued chapter compatibility belongs only to that item.

Published V0.3.3 uses schema 6 / balance 0.3.3, with genuine schemas 1-5 migration.
It adds rainFilm and railCore, four external recipes, whole-package mixed cargo,
target contracts and buffers, and two vehicle modifications. Components remain
home-only. Specialty resources have finite uses; do not add recurring upkeep or
daily tasks. src/game/journey.ts defines vehicles, three archives and remaining
uses. CM04-CM06, F05/F06 and L03 complete the fixed third batch.

New shipments reserve their whole destination space and snapshot the selected
recipe, manifest, cargo, fee, wear, duration and vehicle capacity. Derive reserved
space from shipments; inventory plus reservations must stay within capacity.
Production, rewards, refunds, deliveries and warehouse removal honor that space.
Old unreserved cargo keeps its original waiting behavior. Vehicle construction
does not activate it; changing the shared active slot requires no occupied train.

Genuine schemas 1-5 validate against their original content boundary before
migration. Finish the whole old offline interval under legacyPending rules at an
explicit captured time, then activate target contracts and new reservations.
Keep the engine independent of wall-clock access. Interrupted settlement retains
the last fully valid state for retry; initial long settlement saves only once to
preserve the pre-migration recovery copy. P11 compatibility is per old queue item.

The V0.4 outpost system uses independent outposts, not city.districts. At most one map is
active; sealed maps keep their inventory and results without simulation. All
outpost crew retain their original beds and count against home availability.
The global queue has at most three projects and fixes one head per second;
only its scope can supply repair labor or costs. Outpost refunds remain local.
Outpost components are produced locally, never transferred from home.

src/game/outposts.ts holds explicit local rules; outpost-save.ts validates their
provenance, scope and conservation. Initial transfers and finite supply packages
use supportSent/supportReceived, not the night-network import/export ledger.
One package can be in transit, its whole destination space is reserved, and
each map can send at most four additional packages over its lifetime. Arrival
happens after local production, so cargo is usable on the next second. Sealing
requires no local queued project or in-transit package and explicit clearing of
any future supply list. Reopening never refreshes supplies, allowances or rewards.
Knowledge requires manual one-time handoff; it never enables an arrangement.
Genuine schemas 1-6 must reject new outpost fields before migration. Empty
outposts preserve the released V0.3.3 offline economy; schemas 1-5 retain the
existing legacyPending settlement boundary.

Published V0.5 keeps calendar state independent of inventory resources. P13 records
its unique simulation-time origin; L05 decisions remain manual. Storage and
scheduling start disabled. Each second can capture one paid second, prepare
one complete local batch, and execute at most the fixed calendar head.
Arrivals occur before calendar preparation; ordinary node production then
honors held inputs and output space. Capturing time and spending it happen
after existing network, field and outpost support work. A boost spends 60
stored seconds and one allowance, runs 60 shared node-production steps and
does not advance any other system. Cancellation releases logical holds without
moving inventory. Calendar service uses the existing global home work queue
and increments a separate repeatable counter. Never auto-fill orders, change
node modes/contracts, or refresh allowances on reopening.

## Required Behavior

- Assignments respect resident counts and facility job limits.
- Inventory remains nonnegative and within capacity.
- Outputs and inputs scale together when capacity or supply is limited.
- A single work project runs at a time. Its completion applies once.
- Refunds do not increase lifetime-earned counters.
- Pending event decisions wait for the player; claims apply once.
- Online, background, and offline progression share the same rules.
- Return reports distinguish production, rewards, operating costs, project reservations, and refunds.
- Only one browser tab owns simulation and save writes.
- Both transport endpoints, recipes, in-transit cargo and home ledgers conserve resources.
- Contract pauses preserve current shipments; route wear never cancels cargo.

## Verification and Delivery

During bootstrap, verify document links, names, scope consistency, whitespace, staged files, and local/remote Git synchronization. Application tests do not apply to a documentation-only initialization.

During implementation, map required checks to FR-01 through FR-14 and the relevant engine/browser scenarios in the technical proposal. Verify actual gameplay and save behavior, not only text or constants.

Use configured Git identity. Commit and push within the user's requested scope. Preserve existing work and avoid force pushes or destructive history operations.

Follow applicable environment instructions and triggered skills. Read their required companion documents before dependent actions. Do not create sub-agents unless the user or applicable instructions explicitly request delegation.

## Communication

- Write agent instruction files in English.
- Give progress and final responses in Chinese.
- Start non-final progress with [MODE: <STAGE>].
- Start the final response with STATUS: DONE, STATUS: INCOMPLETE, or STATUS: BLOCKED.
- Explain material unfamiliar technical terms in Chinese, retaining the English term.
- Distinguish proposed behavior, implemented behavior, and verified results.
