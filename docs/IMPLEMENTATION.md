# blurtReply implementation

## Product

Course revision through a short oral examination. Choose a sample subject or upload/paste selectable course material, explain concepts aloud, face a follow-up aimed at a specific claim, and leave with evidence-linked revision actions. The current prototype supports English-language interactions and three concepts per practice, each with an opening question and one adaptive follow-up. Six answers are a bounded practice, not an assessment grade.

## Cooperating agents

1. Curriculum planner selects three concepts and valid source IDs from supplied material. The application attaches the entire original excerpt; it does not ask the model to reproduce a quotation.
2. Examiner retrieves relevant source excerpts through a bounded tool loop, interprets an answer, writes a short conversational reply and proposes the next question. When the student is unsure or asks for an explanation, the reply teaches one small idea from the notes before a simpler follow-up.
3. Evidence checker independently reviews the examiner's proposal, including the spoken explanation, against the student's words and sources. Unsupported feedback is rejected or softened into a clarification; exact quote validation also runs in code. A helpful explanation never counts as evidence that the student already understood it.
4. Revision coach reads the accumulated accepted evidence and prepares specific next steps linked to turns and source excerpts.

Every agent has a distinct instruction set, output contract and state transition. The session stores visible activity events and evidence; it never exposes hidden model reasoning. Demo mode is explicitly authored and incurs no model calls. Failure output is labelled, and never passed off as live agent work.

## Experience

Visual thesis: a focused midnight-blue revision studio, with warm white typography and one electric periwinkle accent. A large audio-responsive voice form anchors the practice screen. Instrument Sans and Newsreader retain locally served fonts.

Content: course preparation, a question-and-answer stage with source/evidence inspector, and an actionable session review. No classroom pairing, host dashboard or votes.

Interaction: after an answer, the saved conversational reply appears above the next question. Voice mode speaks the reply and question together before the microphone opens; the voice form reacts to actual microphone level. The final answer also receives a closing response, with no further microphone capture. Agent activity shows real handoffs without fabricated progress percentages. Respect reduced motion and provide editable text input throughout.

## Architecture and ownership

- React/Vite/TypeScript interface, Express server, local SQLite. Existing OpenAI key stays in ignored `.env.local`.
- PDF text extracted in the browser with PDF.js, with cancellation, page progress and a 30-second deadline. Replacing, editing or clearing an import invalidates its result; failures preserve the previous draft. Text/Markdown can also be read locally. Only extracted text is sent to the application server. PDF page markers bound source excerpts and supply page metadata; unmarked notes retain their original sentence-based splitting. Scanned PDFs require pasted text; partially scanned PDFs report unreadable pages. No OCR promise.
- Microphone records bounded turns, then OpenAI `gpt-transcribe` transcribes them. A voice session submits the completed transcript automatically after **Done speaking**, unless transcript review is enabled or a draft/interrupt needs attention. The manual typed path remains available. Audio is not stored by this app.
- Examiner audio uses browser speech without a provider key; optional ElevenLabs synthesis uses a server-held key, Sarah with Multilingual v2 by default, and caches each reply/question combination by text, voice, model and settings. Combining the reply and next question uses one synthesis request per turn. Playback and recording can be paused, resumed or stopped. Resume is available beside the paused microphone; draft or interrupted recordings require review before submission. Older saved practices without a conversational reply use their existing observation.
- Loopback-only server by default. Browser identity owns its sessions; no public sharing or deployment.
- Supabase is not required: the local SQLite database stores course content, answers and reviews, and an anonymous browser cookie controls access. Accounts and cross-device synchronisation are outside this local prototype.
- Existing `vivacoach` database, cookie, environment-variable and browser-storage names remain internal compatibility identifiers so the blurtReply rename preserves saved sessions and configuration.
- Pairwise remains at `SH4D0W074/pairwise`, tag `pairwise-v1`, commit `059cd8f`. blurtReply uses a separate branch and private backup repository.

## API contract

- `GET /api/status` → ServerStatus.
- `GET /api/samples` → SampleCourse[].
- `GET /api/practices` → RecentPractice[] belonging to this browser, no identity creation on public reads.
- `POST /api/practices {mode, sampleId? ,title?,sourceName?,text?,origin?}` → a persisted PracticeSession in the thinking phase, then background preparation. Only this create mutation allocates an anonymous identity.
- `GET /api/practices/:id` → owner-only PracticeSession. Poll while thinking to see actual agent events.
- `POST /api/practices/:id/answers {questionId,answer,idempotencyKey}` → PracticeSession in the thinking phase. Persist input before AI calls; reject parallel or stale submissions, replay idempotently. The browser polls real progress.
- `POST /api/practices/:id/finish {}` → PracticeSession. Allowed when ready; creates a review from completed turns.
- `POST /api/practices/:id/transcriptions` with a raw audio body and its audio Content-Type → `{text,model}`. Owner only, bounded payload, no storage.
- `POST /api/practices/:id/question-audio {questionId}` → MP3 of the saved reply followed by the current question, or the closing reply when complete (using the last answered question ID). Owner only; optional provider, cached. The client cannot supply arbitrary speech text.
- Error JSON `{error,code}`; errors must not expose provider bodies or secrets.

## Agent module contract

`server/agents.ts` exports `prepareCourse(input, mode, emit)`, `reviewAnswer(course, question, answer, turns, mode, emit)`, `createReview(course, turns, mode, emit)`, and `getTextAIStatus()`; return types are CourseContent, Feedback, PracticeReview, and the text-related subset of ServerStatus. `getTextAIUsage()` exposes process counters without prompts or secrets for local validation. `server/courses.ts` exports sample-course previews, source material, and explicit authored-demo fixtures. Emit receives AgentReporter events.

`server/voice.ts` exports `getVoiceStatus()`, `transcribeAudio(buffer, mime, context)`, and `speakQuestion(text, cacheKey)`. Provider calls have deadlines, no automatic retry, and conservative call caps. Root owns this file.

## Validation goals

Real source upload, quote provenance, evidence-checker veto, bounded tool execution, saved/reloaded sessions, simultaneous submit protection, microphone denial and editable transcription, unconfigured/failing provider states, complete guided demo, mobile layout, keyboard access, and real live API checks within the previously approved modest budget.

## Verified API references

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text): completed recordings through `audio.transcriptions.create` using `gpt-transcribe`.
- [OpenAI GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): economical text model used for the four roles.
- [ElevenLabs text-to-speech](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming): server-held voice key and audio generation. Real playback and cached replay were verified on 7 November 2026.
