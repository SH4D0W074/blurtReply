# Pairwise implementation plan

## Decisions

- Build the agreed peer-learning loop: answer and reason → cautious interpretation and clarification → lecturer-approved peer discussion → independent transfer question.
- Local application first. No Supabase, Vercel account or public deployment is required.
- React and TypeScript interface, Vite build, Node/Express server, SQLite persistence. One origin for the interface and API. Polling keeps small rooms synchronised without hosted realtime infrastructure.
- Private GitHub backup at SH4D0W074/pairwise. Commit and push meaningful milestones; never commit keys, participant data or database files.
- Anonymous browser identities, server-owned host controls, separate lecturer/student/presentation views. Displaying explanations is an explicit lecturer reveal; students see a disclosure before submitting.
- Two fully authored lessons: sampling bias and forces/motion.
- Clearly labelled demonstration fixtures. Live model failures never silently turn into simulated analysis.

## Visual direction

Warm paper workspaces, an ink-dark presentation wall, electric vermilion actions. Instrument Sans and Newsreader. Answer objects are the main visual: answer → explanation → paired discussion. Keep ordinary controls restrained. Respect reduced motion and mobile screens.

## Milestones

- [x] Foundation, shared contracts, secret exclusions and repository setup.
- [x] Persistent rooms, anonymous joining, host permissions and response collection.
- [x] Evidence-checked model analysis, clarification and deterministic pairing.
- [x] Complete lecturer, student and presentation interfaces.
- [x] Independent transfer question, honest summaries and labelled demo mode.
- [x] Integration, failure-path tests, keyboard controls and browser inspection.
- [x] Local launch instructions and concise demo script.
- [x] Final source, local launch guide and demo script backed up to GitHub.
- [x] CI confirmation on the final source revision (`746b9ac`).

Live provider verification is complete using synthetic input and an owner-approved budget. Both lesson checks and the live classroom browser flow passed; see [validation notes](VALIDATION.md). The complete local demo and fallback classroom flow still run without credentials.

## Acceptance checks

- Two independent student browsers can join, respond, refresh and continue the same room.
- A participant cannot execute host actions or retrieve unrevealed peer reasoning or answer keys.
- Duplicate submissions and overlapping host actions cannot create duplicate pairs or lose answers.
- A quoted span must occur in the actual response; a valid quote is not treated as proof that the model's interpretation is correct.
- Compatible reasoning categories do not become fabricated contradictions. Ambiguity produces clarification.
- All submitted students receive one pair, triad or explicit solo activity.
- A fresh question follows discussion. Summaries report actual responses rather than mastery or proven learning gains.
- Missing credentials, slow analysis, failure, empty rooms and reconnecting all have usable states.
- Seeded answers and analysis are labelled demonstration data.

## API contract

All mutations use JSON and an HttpOnly anonymous browser session. GETs are not cached.

- GET /api/status → ServerStatus
- GET /api/lessons → PublicLesson[]
- POST /api/rooms { lessonId, mode, title? } → RoomSnapshot (host)
- GET /api/rooms/:code?view=host|board|student → RoomSnapshot (role-filtered)
- POST /api/rooms/:code/join {} → RoomSnapshot (student)
- POST /api/rooms/:code/responses { stage: initial|transfer, choiceId, reason } → RoomSnapshot
- POST /api/rooms/:code/clarification { text } → RoomSnapshot
- POST /api/rooms/:code/actions { action, version? } → RoomSnapshot (host)
- Errors: { error: string, code?: string }, appropriate HTTP status. Stale versions return 409.

The public lesson contract never includes answer keys, rubrics or authored example responses. Board cards include reasons only after reveal. Analysis categories are lecturer-only; student views include only their own analysis and published group. Pair IDs and aliases are anonymous, not names.
