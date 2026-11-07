# Demo capture

`capture.mjs` backs up the browser sequence used for the recorded blurtReply walkthrough. It uses the real application and real configured providers. Running it can spend API credits; it does not retry failed captures or generate narrator audio.

Run an already configured app server separately. Install the project dependencies and provide Google Chrome, or select a browser executable with `BLURT_DEMO_CHROME_PATH`. The script reads no API keys; the application server owns provider configuration and process budgets.

Prepare a fresh directory under the ignored `.local/` tree containing:

- `audio/student.wav`: a prerecorded WAV saying “I don’t know. Could you explain it?”
- `audio/student.json`: its duration in seconds and a description of its origin, for example `{"duration":3.4553125,"source":"Synthetic demo student voice generated with macOS Daniel; no real microphone."}`. Measure the duration of the actual WAV you use.

From the repository root:

```sh
node scripts/demo/capture.mjs .local/demo-video/new-take
```

The output argument, or `BLURT_DEMO_DIR`, must point inside this repository’s `.local/` directory. That tree is ignored by Git. The capture writes a synthetic browser identity to `context.json`, along with session snapshots, JPEG frames, examiner MP3 responses and `capture.json` timing metadata. Do not commit or publish those raw files. The final edited video is a separate export.

Configuration:

| Setting | Default |
| --- | --- |
| `BLURT_DEMO_URL` | `http://localhost:3000`; use an origin without a path or credentials |
| `BLURT_DEMO_CHROME_PATH` | Optional path to a Chrome-compatible executable |
| `BLURT_DEMO_BROWSER_CHANNEL` | `chrome`; used when no executable path is supplied |
| `BLURT_DEMO_DIR` | `.local/demo-video`; the command-line directory takes precedence |

The recorded sequence uses the statistics sample, one prerecorded spoken help request, and one scripted typed answer based on the explanation received. It then finishes the same two-answer practice and records its revision review. Chrome supplies the WAV through a fake microphone device; OpenAI performs real transcription and agent work, and ElevenLabs generates the two examiner speech clips. The script records original provider audio bytes and playback timestamps. It does not fabricate agent activity, responses or review results. It stops with an error if the expected live checks fail.

The capture plan allows at most 10 text requests, one transcription and two voice generations. The script checks available capacity before starting and reports the process-counter difference afterward. Those counters are shared, so use an isolated server for reliable accounting. Server process limits remain the hard limits; the script does not change them. For a separately authorized fresh capture server, the corresponding settings are `VIVACOACH_MAX_AI_CALLS=10`, `VIVACOACH_MAX_TRANSCRIPTIONS=1` and `VIVACOACH_MAX_VOICE_CALLS=2`. Failed provider attempts count, and no automatic retries occur.

Use captions to disclose the prerecorded synthetic student and any synthetic narration in the final edit. Label shortened processing waits. Do not present the scripted second answer as evidence of a real learner’s improvement. UI wording and provider timings can change, so inspect a new recording before using it.

## Editing and export

The delivered video and captions are in [`artifacts/demo`](../../artifacts/demo/README.md).

`build-edit.mjs` describes this particular recording: it reads `.local/demo-video/take-2/capture.json` and its corresponding session, frames and audio. It also expects the three narrated MP3s and their `narration.json` metadata in `.local/demo-video/narration/`, and title cards in `.local/demo-video/art/`. These private source assets remain local; the exported MP4 is backed up. A new recording requires adjusting the edit's clip boundaries and spoken captions to match its actual timings and output.

`render-cards.py` recreates the title cards using Pillow and the macOS Arial/Georgia fonts. Its optional argument selects the output directory; the default is `.local/demo-video/art`.

The export uses macOS AVFoundation and needs no FFmpeg or external render service:

```sh
node scripts/demo/build-edit.mjs
swiftc -parse-as-library scripts/demo/render-video.swift -o .local/demo-video/render-video
.local/demo-video/render-video .local/demo-video/edit.json
```

The renderer takes a JSON manifest with `output`, `width`, `height`, `fps`, `duration`, `frames` and `audio`. Frame entries contain `at`, `file`, `kind` (`screen` or `card`), and optional `title`/`subtitle`. Audio entries contain `file`, `at`, and optional `trimStart`/`duration`. Paths resolve relative to the manifest. Existing output files are rejected rather than overwritten. Audio clips mix at full volume; keep narration and examiner speech from overlapping.

Export verification checked the 78.9-second duration, 1080p H.264/AAC tracks, readable sampled frames, audio in all six intended intervals, no digital clipping and a fast-start MP4 container. Captions are burned in, with a separate SRT copy.
