# V0.3.1 local implementation

Status: COMPLETE for local delivery on 2026-10-15.

Outcome: deliver the complete first batch of the corrected experience expansion,
as fixed in docs/V0.3.1_SPEC.md. The remaining two batches retain their roadmap
scope and require feedback from this batch before implementation.

Authorization: local design corrections, implementation, integration, verification,
and delivery documentation. No commit, push, or public deployment in this task.

Registration: UNREGISTERED. `codex-plan status --json` reports that official
session identity requires a fresh PreToolUse binding. Do not fabricate a session.
The file remains the current implementation checklist.

Parallelism: serial. Shared simulation/save/UI changes are coupled, and no
delegation is authorized.

- [✅] Fix and record the six review dispositions; pin the first-batch scope.
- [✅] Implement assembly, conservation, shared jobs, targets, and recovery.
- [✅] Implement all four L01 nodes, blueprints, and both workbench modifications.
- [✅] Implement optional prefabricated construction with consistent project snapshots.
- [✅] Implement state-based streetscape, mobile shortcuts, and concise reports.
- [✅] Migrate genuine schema 1/2/3 saves and preserve original offline behavior.
- [✅] Verify UX01-UX08 and UX21, original FR/C/N regressions, and production build.
- [✅] Record actual routes, verification limits, documentation, and local handoff.

Completion evidence: 95 unit/storage tests, 30 browser tests, the final 7-test
experience UI rerun, TypeScript and production build, isolated production-preview
new-save/V0.3 migration checks, and inspected desktop/mobile screenshots. See
docs/VERIFICATION.md and docs/PLAYTEST.md. Local scope is complete; independent
human feedback remains unperformed and gates only the subsequent batches.
No Git commit, push, deployment, or user-browser save mutation occurred.
The task-owned preview server was stopped. Browser tests reused the pre-existing
project development server at 127.0.0.1:5173, which is retained for local play.
Ignored build/test artifacts are retained for local review. Registration remains
UNREGISTERED as documented above; no unsupported CLI lifecycle transition is claimed.

Dependencies: locked installed toolchain; existing pure simulation and browser
test harness. Human playtest recruitment is outside local implementation;
record it as unperformed and keep it as the gate for the next content batch.

Recovery: preserve original fixtures and unrelated edits. Fail closed for unknown
save versions. Do not alter browser user saves; tests use isolated contexts.

Retention: keep source, specifications, tests, and verification evidence. Generated
dist/test artifacts remain ignored; remove only task-owned temporary files and
stop any task-owned preview service unless needed for the local handoff.
