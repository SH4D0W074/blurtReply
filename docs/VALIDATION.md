# blurtReply validation

Checked locally on 7 November 2026, using Node 24 and Chrome. Automated checks run on every code push to the private blurtReply repository.

## Automated checks

- **56 unit/integration tests:** course fixtures, planner source selection, examiner tools, verifier veto/softening, provenance, prompt-injection boundaries, call budgets, timeouts, provider failures, revision evidence, session ownership, idempotency, persistence, crash recovery, audio boundaries, cached replay after the voice cap, oversized streamed audio rejection, voice/model cache separation, configuration validation and page-aware PDF passages that preserve exact text.
- **31 browser scenarios:** full six-answer demo and mobile practice; real PDF extraction through page-specific source dialogs; import replacement, custom titles, progress, cancellation, timeouts and preservation of drafts; damaged, scanned, locked and oversized PDFs; playback, device fallback and provider budgets; automatic question-to-microphone-to-answer progression; transcript review; pause/resume from both controls, including late transcripts, existing drafts and failed recordings; microphone denial and safe reload. Voice cases use mocked provider responses and generated PCM audio with real browser decoding/playback. A deterministic recorder and WebAudio stream cover lifecycle ordering without accessing a real microphone.
- TypeScript checking and production build pass.
- GitHub Actions also runs installation, typechecking, tests, build, and Chromium browser tests without real API credentials.

## Live checks

1. **Four-agent text flow:** a real planner prepared a statistics practice. The examiner used `read_source`, proposed feedback on a causal overclaim, and passed it to a separate verifier. The verifier accepted the first proposal, softened the second, and the coach excluded the unassessed answer. Eight text requests, two source-tool calls, no failed provider calls; approximately 21.5 seconds for the two-answer sequence and review.
2. **Browser microphone flow:** synthetic speech was supplied through Chrome's real microphone recording interface. The waveform responded to measured audio, OpenAI returned the spoken sentence, and the editable transcript was submitted through the actual examiner/checker/coach flow. All four agent roles appeared and the final review came from live AI. No real microphone was accessed during this test; no browser JavaScript errors occurred.
3. **Recorded speech:** a 5.4-second synthetic WAV produced the expected transcript through `gpt-transcribe`. Two earlier attempts using an empty system-generated file were rejected; the corrected recording and browser WebM path both passed.
4. **Uploaded subject:** custom ethics notes produced distinct concepts for consequences/welfare, duties/constraints and character/practical judgement. Every citation matched the original supplied text. This test exposed and resolved a fragile planner quotation-copying requirement: the planner now selects source IDs and the application attaches exact text.
5. **Live ElevenLabs playback:** after configuring the server key, Chrome played a real 5.62-second MP3 for an 89-character examiner question through the production app. The interface showed **ElevenLabs voice**, with no device fallback or browser errors. Replaying the question worked and left the generation counter unchanged. This check used one ElevenLabs generation and one OpenAI planning request; audio bytes were not independently compared.
6. **Automatic blurtReply voice session:** the production app played the first question, opened Chrome's real recording interface with synthetic input, transcribed and automatically submitted exactly one answer, then played the adaptive follow-up. The response received live AI feedback and an evidence check. Pause released every microphone track; no device-speech fallback or browser errors occurred. This bounded check used two ElevenLabs generations, one transcription and four text requests. Desktop and mobile screenshots confirmed the new branding and controls; the tested mobile layout had no horizontal overflow.
7. **New examiner voice and visible Resume:** the updated production app played a 91-character question using Sarah and `eleven_multilingual_v2`, then opened Chrome's synthetic microphone. Pause stopped all tracks; the prominent Resume button replayed the cached audio and opened a new capture. Both playbacks finished, no device fallback occurred, and the paused desktop/mobile layouts showed the button without horizontal overflow. This check used one ElevenLabs generation, one planning request and no transcriptions. It verifies delivery and controls, not a human listening preference study.
8. **Real PDF import checks:** the Memory and storage PDF produced 22,887 characters with all 19 page markers; the Reply presentation produced 1,578 characters from 7 of 15 pages and explicitly reported the 8 pages with no selectable text. Both filenames generated the correct topic title. Chrome reported no JavaScript errors and no API write was attempted. Four source-parsing regressions also cover nonconsecutive page numbers, long qualified sentences, CRLF/preface text and plain notes with inline page references. Existing saved practices were not rewritten.

The measured eight-request text check used 5,504 input tokens and 1,512 output tokens (including 413 reasoning tokens), about $0.00131 at the documented model rates. Overall testing used a small number of additional bounded requests; account billing was not queried. No unbounded loops, automatic retries or long voice sessions were used.

## Visual and recovery checks

- Desktop layouts checked at 1440×1000, 1440×900 and 1280×720; mobile at 390×844. Source text wraps, modal content remains readable and the tested layouts have no horizontal overflow.
- Reduced motion, reading mode, keyboard tab navigation, source-dialog dismissal and editable drafts were exercised.
- Restart simulations covered planner, examiner and coach work. Saved inputs remained available, late results were discarded, and no paid retry was started automatically.
- Both authored sample courses completed all six answers without model calls.

## Limits of these checks

- Live model outputs vary. This is a small end-to-end check, not a learning-outcome study or a broad accuracy evaluation across university subjects and accents.
- ElevenLabs was checked with short English questions, a cached replay and an automatic follow-up. This verifies the configured voice and playback path, not every voice, language or network condition.
- Microphone permission behavior and device speech vary by browser. Chrome's recording flow was verified; the typed path remains available elsewhere.
- Scanned PDFs and diagrams are outside scope. Very long unbroken source passages or ambiguous source material can lead to labelled fallback feedback.

Detailed synthetic test reports and screenshots are in ignored `.local/validation/`. They contain no API keys and are intentionally excluded from the GitHub source backup.
