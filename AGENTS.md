# DistrictZero Project Guidance

## Project Identity

- Canonical project and English display name: DistrictZero.
- Chinese game identity: 第0街区. Preserve the Arabic digit 0 in Chinese titles and address labels.
- Repository: https://github.com/lxjmaster/DistrictZero.
- Genre: contemporary supernatural fiction, text-based management, and idle progression.
- The central theme is building a future from an unregistered beginning. Zero may express despair, a first existence, or open possibility.

## Current Authorization Boundary

The bootstrap task covers cloning the empty repository, adding initialization documents, making the initial commit, pushing that commit, and producing a handoff prompt.

Stop after that handoff. Game scaffolding, dependency installation, application implementation, and service execution belong to the next task after the user continues from this project directory.

The next user's instruction or invocation of the handoff prompt can authorize implementation. Do not request repeated approval for an unchanged authorized outcome.

## Authoritative Design

Read these documents before implementation:

1. docs/PRODUCT_SPEC.md
2. docs/TECHNICAL_PLAN.md

docs/HANDOFF_PROMPT.md records context for resuming work; it is not an automatic trigger to start implementation when encountered during initialization.

User instructions override design assumptions. Preserve unrelated or concurrent changes. Update the relevant specification when an authorized material design decision changes.

## Implementation Baseline

- Target a single-player browser game in Simplified Chinese, with desktop and mobile layouts.
- Use the proposed TypeScript, React, Vite, plain CSS, Vitest, and Playwright stack after checking compatible versions and the local environment.
- Keep the simulation independent from UI rendering, browser storage, and wall-clock access.
- Store content and balance values as explicit configuration.
- Use stable IDs, versioned saves, and one simulation model for online and offline time.
- Treat the initial numerical values as playtest candidates.
- Implement V0.1 before introducing later-city, calendar, or covenant systems.

No package manifest, application commands, or implemented tests exist at bootstrap. The commands in the technical proposal are planned commands; establish them before reporting that they work.

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
