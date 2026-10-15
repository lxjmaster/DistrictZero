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
criteria passed. V0.3.2 has no new push or deployment authorization. V0.3.3 remains
planned. V0.3.1 and its publication documentation are now pushed through
`ac72f1e`; both Pages workflows succeeded. Implement V0.3.2 against
`docs/V0.3.2_SPEC.md` locally. Do not change fixed values to make tests pass or silently reduce
acceptance scope.

V0.3.2 is now implemented and verified locally: 137 engine/storage tests,
36 browser tests, type checking, the production build and isolated preview
passed on 2026-10-15. See docs/VERIFICATION.md and docs/PLAYTEST.md for the
required scenarios, measured routes and unsampled human feedback. The local
workspace uses schema 5; the published site remains V0.3.1 / schema 4. No
V0.3.2 commit, push or deployment has been performed. The pre-existing
127.0.0.1:5173 development server remains available for this local handoff;
the task-owned 4173 preview server was stopped.

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

Local V0.3.2 uses schema 5 / balance 0.3.2, with genuine schema 1/2/3/4
migration. Published V0.3.1 saves use schema 4 and balance 0.3.1, with explicit migration from
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
