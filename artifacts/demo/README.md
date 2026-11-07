# blurtReply hackathon demo

- **Video:** [blurtReply-demo.mp4](blurtReply-demo.mp4) — 78.9 seconds, 1920×1080, 25 fps, H.264 video and AAC audio.
- **Captions:** [blurtReply-demo.srt](blurtReply-demo.srt). Speech captions are also burned into the video.
- **Poster:** [blurtReply-demo-poster.png](blurtReply-demo-poster.png).

## What the demo shows

1. Choose a sample subject or open the course-material input.
2. The planner prepares concepts linked to source excerpts.
3. The examiner asks a question aloud. A student asks for help.
4. The examiner retrieves evidence and an independent checker reviews its response.
5. The app explains the concept aloud before asking a follow-up question.
6. Open the original source and inspect the agent activity.
7. Review specific next steps linked to the answers and source passages.

**Narration and the AI examiner are voiced by ElevenLabs**, using the configured Sarah voice and `eleven_multilingual_v2`. The examiner clips are the original audio played by the app during this recording. Narration is generated separately for the edited walkthrough.

The short student line is a prerecorded synthetic macOS Daniel voice routed through Chrome's simulated microphone. The app genuinely transcribes it and runs its AI workflow. A scripted second answer is submitted before generating the review; it demonstrates assisted practice, not measured learning improvement. The UI and AI results come from one real session using blurtReply's authored Statistics sample notes.

The video is edited: one processing wait is shortened by 2.8 seconds and labeled on screen, source and agent screens are reordered and held for readability, and later activity is cut to the same session's review. Audio is played at its original speed. Caption phrase timings are approximate. Browser cookies, provider keys and raw session captures are excluded from the backup.

The successful capture used eight text-model requests, one transcription and two examiner voice generations. Narration used three additional ElevenLabs generations, totaling 640 input characters. Earlier recording attempts required extra calls; these numbers describe the successful take and narration only.

Recording and editing tools are documented in [scripts/demo](../../scripts/demo/README.md). This file and its assets are a local/private-repository deliverable; no public video upload was made.
