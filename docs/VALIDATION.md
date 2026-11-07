# Validation and limits

## Automated checks

Local result on 7 November 2026: **46 unit/integration tests and five browser scenarios passed**, along with TypeScript checking and the production build. Browser verification used installed Chrome on macOS; Safari and Firefox were not tested.

[GitHub CI also passed on source revision `746b9ac`](https://github.com/SH4D0W074/pairwise/actions/runs/42383823120), including a clean dependency install, TypeScript, the unit/integration suite, production build and all five browser scenarios using Chromium on Linux. Subsequent documentation-only updates do not rerun this workflow.

- TypeScript checks the frontend, server and shared contracts.
- Unit tests exercise authored lessons, model output validation, exact evidence provenance, malformed/refused/timeout responses, supported model parameters, response caps and deterministic grouping.
- HTTP integration tests exercise persistent sessions, role filtering, host-only controls, invalid inputs, duplicate responses, stale transitions, clarification invalidation and private source paths.
- Browser tests exercise the complete labelled demo, two independent mobile students, draft recovery, rejoining, group publication, transfer responses, accurate totals and rejected lecturer access.
- Every automated browser session explicitly disables live AI and uses a separate temporary database.

## Manual inspection

Inspected the landing screen, lecturer workspace, dark presentation reveal/group/reflection screens and mobile answer/discussion screens. Checked a tall 1440 × 1000 display and a 1280 × 720 projector layout, with phone-width student layouts. Corrected clipped quotations, projector pagination and a reduced-motion card visibility bug. The browser regression checks reduced-motion transforms and the full-explanation dialog. Lecturer tabs support arrow, Home and End keys.

The final classroom regression also checks delayed polls cannot undo a successful join, saved clarifications remain visible, and a participant who missed the initial round can still submit the fresh question without inflating matched-response counts.

## Still requires the owner’s credentials

No paid OpenAI call was made in the initial build. The schema and error handling are tested with stubbed provider responses. Before presenting this as a live AI demonstration, enable the configured model with an approved testing budget, submit at least two deliberately different explanations and one ambiguous explanation, and inspect the real classifications and quotations.

Account model access, actual response latency and interpretation quality have not been established by offline tests. API failures must remain labelled fallback output.

## Deliberate limits

- Two teacher-authored lessons; no arbitrary lecture import.
- Default AI batch is eight initial responses. Excess responses are retained and unclassified.
- Model interpretations can be semantically wrong even when the quoted evidence is exact.
- Before/after counts use different questions; they are not causal evidence of learning.
- Browser identities use a session cookie. Losing the host cookie loses the controls; there is no password recovery or university SSO.
- Data stays on the local server except for explicit live AI analysis. There is no automatic remote backup of student data.
- Local-only default. No public deployment, cloud database, voice processing or workflow-service integration.
