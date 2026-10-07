# Rep Break

**Turn the 90 seconds between gym sets into a few minutes of real learning, without the doomscroll.**

Rep Break is a React Native (Expo) rest timer for iPhone. When you finish a set, it starts your rest countdown and gives you **exactly one** bite-sized thing to engage with: a quiz-first fun fact, a short read on a real news story, a brain teaser, a quick reflex game, or the next chunk of a lesson on a topic *you* chose. When the rest ends, the app takes your phone back with a haptic buzz and a lock screen, so you go back to lifting instead of scrolling.

Most people already pick up their phone between sets. Rep Break uses that habit for learning without letting it take over the workout.

---

## Features

| Mode | What happens during your rest |
|---|---|
| **Study** | Bring your own material (a topic, a URL, a PDF, or a screenshot). The AI breaks it into a progressive lesson, one chunk per rest, sized to your rest length, with a progress bar across sets. |
| **Fun fact (quiz-first)** | You answer a multiple-choice or true/false question *before* you see the fact. Your first tap is final, then you get feedback and an explanation. |
| **Short read** | A short summary of one real, recent article from a major outlet, with a link to the source. |
| **Brain teaser / Game** | A short puzzle, or a paddle-and-ball reflex drill with scoring. |

**Workout tools:** rest presets (30s to 2min), "I need more rest" (switches to open-ended count-up), an "End rest now" button, haptic hard stop at the end of rest, and named workout groups that record how long you actually rested on each set (total and average).

## Tech stack

- **App:** React Native 0.86 + Expo SDK (managed workflow), Hermes JS engine
- **AI:** OpenAI-compatible Chat Completions and the Responses API with the `web_search` tool
- **Backend:** small Node/Express proxy (`server/`) that combines RSS + Hacker News, extracts `og:image` previews, falls back to Wikimedia Commons, and fetches URL text for Study mode
- **Storage:** on-device persistence for settings, content history, and workout reports (`expo-secure-store`)
- **Distribution:** EAS Build → TestFlight

```
app.js                      Main app: timer state machine, rest UI, modes, reports
src/services/aiContent.js   Live reads/facts: prompting, source rotation, de-duplication
src/services/studyContent.js  Study mode: progressive chunk generation + images
src/services/storage.js     Local persistence helpers
src/data/content.js         Offline fallback content
server/news-proxy.js        News aggregation, image enrichment, URL fetching
PROJECT_LOG.md              Versioned design and decision log (v1 to v24)
```

## Engineering challenges

I logged every iteration in [PROJECT_LOG.md](PROJECT_LOG.md) (24 versions). These were the most interesting problems:

### 1. Making AI content progressive, not repetitive
Early Study mode kept re-explaining the same basics, because the model only saw previous chunk *titles*. I redesigned the context so each request carries the last five chunks' body excerpts and an explicit list of **"angles already covered"**. The prompt also requires every chunk to pick one new, narrow angle (a person, an event, a decision) and build on what came before. The lesson now goes deeper with each rest instead of starting over each time.

### 2. Making sure users actually learn something, not just see it
Reading a fact doesn't mean remembering it. I changed facts to **retrieval practice**: you commit to an answer before the fact is revealed. Two small details mattered a lot:
- the card title was leaking the answer, so it stays hidden until you answer
- the first tap is final, so you can't just tap through options until one turns green

### 3. Keeping it engaging without becoming addictive
The product rule is **one item per rest, then a hard stop**. Adding features ("give me another", "I need more rest") meant keeping that rule while giving users flexibility. Workout reports record the *actual* elapsed rest, not the planned rest, so users can see an honest picture of their sessions.

### 4. Freshness and trust in AI-generated content
Asking the model for "recent news" in the prompt wasn't enough: reads were stale and repetitive. I grounded each read in one specific real article, rotated across outlets and topic lanes, kept repetition history on the app side using normalized fingerprints (instead of trusting the model to avoid repeats), and show a clickable source only when a real URL comes back.

### 5. Latency and reliability on a real phone
- **Prefetching:** the next chunk/item loads in the background during the current rest, and the first study chunk loads as soon as the mode is selected, so content is usually ready when the rest starts.
- **Stale closure bug:** prefetch callbacks captured an old `restSeconds`, so chunks were sized for the wrong rest length after the user changed presets. I fixed it by reading from a ref that stays in sync.
- **Hermes vs. browser APIs:** `AbortSignal.timeout()` worked on the web but crashed on iOS. I replaced it with a portable `AbortController` + `setTimeout` helper.
- **Graceful fallback:** if the network or AI endpoint fails, the app falls back to bundled offline content. The timer always works.

## Getting started

```bash
npm install
cp .env.example .env        # optional: add an OpenAI key, or enter one in the app's settings
npm run start               # Expo Go; press i for the iOS simulator
npm run news:proxy          # optional: local news/URL proxy on port 8787
```

Requires Node 20+. The original browser prototype is kept in `index.html` / `styles.css`.

## What's next

- **Spaced repetition:** bring back missed quiz questions in later rests
- **Mastery tracking** per Study topic across sessions, not just progress within one session
- Move API calls behind a server so no key ships with the client
- TestFlight beta
