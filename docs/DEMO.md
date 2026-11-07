# VivaCoach demo

## Before presenting

Open http://localhost:3000 on the presentation computer. Choose the statistics sample and prepare a live practice before the pitch, so the first question is ready. Check microphone permission and select **Hear the question** once. When presenting ElevenLabs, confirm the label remains **ElevenLabs voice** while it plays. Keep a free guided demo in a second tab as an explicitly labelled fallback.

The app runs locally, but live agents and transcription need the internet. OpenAI transcribes spoken answers; ElevenLabs speaks questions when its key is configured. The four cooperating agents continue to handle the learning flow. Device speech is the fallback. The free guided demo never calls ElevenLabs.

## One-minute walkthrough

| Time | Show | Say or do |
| --- | --- | --- |
| 0–10s | The source notes and opening question; play its voice | “I can recognise a definition in my notes. Can I actually explain it?” |
| 10–20s | Record an answer; the waveform follows the sound | “If two variables increase together, that proves one causes the other.” |
| 20–30s | Editable transcript, then Submit | Point out that the student can correct transcription before the answer is assessed. |
| 30–45s | Agent activity | The examiner reads a course source, proposes feedback, and hands it to an independent evidence checker. Wait for the real result. |
| 45–55s | Evidence panel | Compare the student's answer with the exact course passage and read the targeted follow-up. |
| 55–60s | Finish here, or a previously completed review clearly identified as such | Show that revision actions point back to saved answers and sources. |

Live timings and exact questions vary. If a provider is slow or unavailable, say so and use **Free guided demo → Use example answer**. The demo never pretends that authored feedback is a live model response.

## 60-second pitch

“You know the feeling: a lecture slide looks familiar, then someone asks you to explain it and the words disappear. VivaCoach gives students a place to practise that moment.

Bring your course notes and explain a concept aloud. Four agents work together: a planner selects concepts from the material; an examiner retrieves evidence and asks follow-ups; an independent checker can reject unsupported feedback; and a coach turns the checked answers into a revision plan.

Watch this answer. I’ve confused correlation with causation. VivaCoach shows my own words beside the source passage and asks a question aimed at that reasoning.

Every revision action links back to evidence from the session. Students leave with a specific explanation to work on, across whichever subject they’re revising.”

## Honest answers for judges

- The four agents have distinct instructions, structured outputs and handoffs. They currently share the same economical language model.
- The examiner chooses read-only source tools in a bounded loop. The verifier makes a separate model call and can prevent a proposal from reaching the student.
- Source quotes are checked against supplied material. That establishes provenance; semantic interpretation can still be wrong.
- Revision is limited to three concepts and six answers. There is no mastery score or evaluation of accent, vocal confidence or personality.
- The two sample courses and guided demo answers are authored for this prototype. User uploads can supply other subjects.
- PDFs need selectable text. Scanned pages, diagrams and faithful mathematical notation extraction are outside the current prototype.
- Request limits and deadlines bound spending and failure. No automatic paid retries run after a server restart.
- Reply and Overall are the natural entries. Only claim an ElevenLabs entry after configuring and demonstrating the actual integration. n8n is not part of the implementation.
