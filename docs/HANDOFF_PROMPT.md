# DistrictZero: Next-Session Handoff Prompt

Use the prompt below after opening the DistrictZero project directory and deciding to begin implementation. Merely reading this file during repository initialization does not start the next task.

## Copyable Prompt

~~~text
Continue development of DistrictZero from this project directory. I am ready to begin implementation of the V0.1 playable version.

Read AGENTS.md, docs/PRODUCT_SPEC.md, and docs/TECHNICAL_PLAN.md first. Inspect the repository and its current Git state, preserve unrelated changes, and follow applicable environment instructions and triggered skills.

Project identity and decisions:
- Repository: https://github.com/lxjmaster/DistrictZero.
- Canonical project and English name: DistrictZero.
- Chinese game identity: 第0街区. Keep the Arabic digit 0 prominent.
- Theme: contemporary urban supernatural fiction and text-based idle management.
- Zero represents an unregistered or unfinished beginning. It can hold despair, a first existence, or possibilities without a fixed limit. Let this meaning influence addresses, stories, and progression.
- Start with a forgotten station, one light, and two night workers. Build facilities and living conditions, then gradually connect a larger world.
- The intended tone is quiet, strange, occasionally funny, and open to a future.
- Players can check briefly, plan actively, or arrange work and return later. Important decisions wait for them.

Existing baseline:
- The repository initialization contains README.md, .gitignore, AGENTS.md, the two design documents, and this handoff prompt.
- No application scaffold, package manifest, installed dependencies, game code, or completed gameplay tests were produced by the initialization task.
- The product and technical documents contain initial configuration values, functional acceptance criteria, and future expansion plans.
- Numerical values are provisional playtest inputs, not verified balance results.
- Any repository state that changed after this handoff should be inspected and reconciled before editing.

Authorized task for this session:
Implement and verify the V0.1 browser-game MVP described in the two design documents. Proceed from setup through a usable local delivery; do not stop after proposing a plan or creating an empty scaffold. Resolve routine implementation choices from the specifications and evidence.

V0.1 scope:
- One district with a complete first chapter ending at address 0-001.
- Energy, parts, and memory.
- Six facility types, four jobs, and shadow/echo resident types.
- Lighting policies and a work queue of up to three projects.
- Three main projects, five events, and two research projects.
- Assignments, production priorities, facility construction and upgrades.
- Automatic saves, import/export, recovery, and one active browser-tab writer.
- A shared simulation for online, background, and offline progression.
- Return reports that explain results and waiting conditions.
- Simplified Chinese game text and usable desktop/mobile layouts.

Technical direction:
- Use TypeScript, React, Vite, plain CSS, Vitest, and Playwright after checking compatible versions and the local environment.
- Keep content/configuration, simulation, persistence, application control, and UI separate.
- Begin with the deterministic one-second simulation specified in the technical proposal. Preserve subsecond remainders and use explicit numerical precision.
- Supply time as input to the engine; keep browser clocks and storage in adapters.
- Make costs, capacities, prerequisites, and stopping reasons visible.
- Maintain correct project reservations and refunds. Refunds do not count as newly earned resources.
- Use stable IDs for projects/events and prevent duplicate completion or reward application.
- Validate versioned saves before replacement and preserve a recoverable valid save.
- Establish actual project commands and document them in README.md once they exist.

Work sequence:
1. Verify environment and repository guidance, then establish the minimal runnable project.
2. Implement content configuration, initial state, production, assignments, and time advancement, with meaningful engine tests.
3. Build the operating UI, facilities, population, lighting, and work queue.
4. Implement the complete first chapter, events, research, and archives.
5. Integrate saves, offline reports, import/export, recovery, and browser-session ownership.
6. Verify desktop/mobile interaction and the complete fresh-save journey to address 0-001.
7. Record actual playtest observations, adjust delivery-breaking balance or usability problems, and deliver a working local game with instructions.

Acceptance:
- Cover FR-01 through FR-14 in the product specification.
- Online, segmented, and offline advancement produce equivalent game states for identical inputs and elapsed time.
- Resource exhaustion, full storage, zero repair workers, project cancellation, repeated event claims, corrupted saves, and multiple browser tabs behave correctly.
- Worker and lighting adjustments cause actual differences in progress.
- Reopening the game preserves progress and shows an accurate return report.
- Report commands actually run, results, current limitations, and any material residual risk. Do not describe unrun checks as passed.

Scope and delivery:
- Complete V0.1 before implementing the V0.2–V0.6 roadmap.
- Keep implementation and verification local unless I explicitly request a remote delivery action. Commit, push, or publish only within the active user's authorization.
- Do not treat later roadmap features as gates for the first playable version.
- Write agent instruction files in English. Keep progress/final responses in Chinese, using the required MODE/STATUS prefixes.
- Do not create sub-agents unless explicitly requested by the user or applicable instructions.
- Ask only for material uncertainty that inspection cannot resolve; otherwise continue the authorized task.
~~~
