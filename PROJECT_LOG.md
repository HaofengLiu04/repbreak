# Project Log

This file is the running project log for Rep Break.

Use it to track the version number, the main changes, and the core ideas behind the work in one compact running record.

When new work is done, append a new version entry instead of rewriting history.

## Entry Template

### Version N
Date:

Summary:

Changes and ideas:

## History

### Version 1
Date: 2026-05-23

Summary: This was the first working prototype of the rest-timer app concept.

Changes and ideas: The original timer-first gym rest prototype was built with rest presets, multiple content modes, and a strict one-item-per-rest flow. The hard end-of-rest behavior was added immediately because the central idea was never to build a content app, but to build a workout tool that briefly uses content and then forces attention back into the next set. The product idea was to solve the dead zone between sets with something short, bounded, and useful enough to keep momentum without opening the door to doomscrolling, while keeping the interaction lightweight rather than visually overbuilt.

### Version 2
Date: 2026-05-23

Summary: This version established the Expo mobile path and the Apple-friendly setup.

Changes and ideas: The prototype was migrated into an Expo / React Native app, and the surrounding setup was filled in with documentation, EAS configuration, and VS Code tasks. The goal here was to position the project for later TestFlight and App Store delivery without introducing unnecessary native complexity too early. Expo was chosen because it is the easiest bridge from a rough product idea to real iPhone testing while the concept is still moving quickly.

### Version 3
Date: 2026-05-23

Summary: This version focused on gameplay and content improvements.

Changes and ideas: The game was upgraded into a paddle-and-ball obstacle mode with scoring, short-read length was tied to the selected rest duration, and a reset control for set count was added. A key idea here was that every rest mode should actually respect the chosen timer instead of pretending to be adaptive while showing the same amount of content each time. The game was treated as a short drill rather than a gimmick, and the product direction stayed centered on improving interaction quality rather than piling on more modes.

### Version 4
Date: 2026-05-23

Summary: This version was about reliability and the first live-content setup.

Changes and ideas: The Expo and web workflows were repaired and the project was upgraded to Expo SDK 54. Persistent rules behavior was added, the fresh-content setup area was collapsed, and local settings persistence was introduced alongside live reads and facts through an OpenAI-compatible endpoint. The main idea was that setup friction should never dominate the screen and that live content should fail back cleanly to local content instead of making the app fragile, since the app still needed to work as a rest timer even when the network or endpoint was not cooperating.

### Version 5
Date: 2026-05-23 to 2026-05-25

Summary: This version focused on rest-session UX and broader live content behavior.

Changes and ideas: The hero area was reduced, a cleaner immersive rest view was added, and the app started to foreground the active item much more aggressively once a rest began. The live-content prompts were broadened so reads were not limited to AI-only coverage, live status messaging became clearer, a direct "End rest now" action was added, and a visible build badge was introduced in the UI. The app was pushed closer to feeling like a workout instrument rather than a dashboard, and both reads and facts were broadened enough to stay interesting over time.

### Version 6
Date: 2026-05-25

Summary: This version added news grounding, repetition control, and richer live content behavior.

Changes and ideas: A lightweight local news proxy was added using public RSS feeds and Hacker News. Short reads were grounded on one selected recent story instead of a vague freshness prompt, and local recent-history tracking was added for both reads and facts so repetition could be controlled on the app side. Optional story image and source metadata were added for live short reads, live fun-fact length targets were increased so they scale more noticeably with rest duration, and Expo was pinned to a fixed port to stabilize the QR and startup flow. The underlying thinking was that freshness should come from real external inputs rather than prompt wording alone, and that repetition should be controlled by the app rather than delegated to the model.

### Version 7
Date: 2026-05-25

Summary: This version improves the image pipeline for live reads and makes the visual side of news-backed content less dependent on what the RSS feed happens to expose.

Changes and ideas: The news proxy now tries to extract `og:image` or related social preview images directly from the selected article page before giving up on visuals. If the article still does not provide a usable image, the proxy falls back to a safer public source by searching Wikimedia Commons for a relevant licensed image based on the story title. The thinking here was that read cards should feel more alive and editorial without forcing the whole experience to depend on one feed's metadata quality. The visible app badge was also bumped to Version 7 so changes remain legible while testing.

### Version 8
Date: 2026-05-25

Summary: This version reduces repetitive live reads by widening the news pool and making source rotation more deliberate.

Changes and ideas: The news proxy now pulls from more feeds, keeps more items per source, fetches a larger Hacker News slice, deduplicates repeated links and titles, and interleaves results so one outlet does not dominate the top of the list. On the app side, read selection now asks the proxy for a larger pool, avoids very recent sources when possible, and stores the story source in recent history so back-to-back repeats are less likely. The proxy still refreshes automatically when the cache expires, so you do not need to manually do anything to get newer stories; the current app behavior is to reuse cached news for up to about five minutes, then fetch a fresh batch the next time the app asks for news.

### Version 9
Date: 2026-05-25

Summary: This version switches live reads to OpenAI web search for testing while leaving facts on the existing chat-completions path.

Changes and ideas: The read flow now uses the OpenAI Responses API with the `web_search` tool when the app is pointed at OpenAI, so the model can fetch a recent story directly instead of relying on the local news proxy. This is only meant as a testing path for now, not a final production architecture. The goal was to let compare a tool-enabled web search flow against the curated proxy flow without rewriting the rest of the app. Facts still use the existing cheaper endpoint path, and the visible app badge was bumped to Version 9 so the testing state is obvious.

### Version 10
Date: 2026-05-25

Summary: This version narrows web-search reads to rotating major publications so the test path is less repetitive and more clearly tied to real newsroom updates.

Changes and ideas: The OpenAI web-search read path now rotates across a small set of big outlets such as Reuters, AP, The New York Times, The Washington Post, Bloomberg, The Wall Street Journal, The Guardian, and the Financial Times instead of searching the open web in a generic way every time. When the selected model supports hard domain filters, the app constrains web search directly; when it does not, the app still steers the model toward those outlets in the prompt so the current testing setup keeps working. The app also avoids reusing the same publication group too closely in recent history. This does not make repetition impossible, because a day with one dominant story can still produce overlapping coverage across multiple papers, but it makes the test behavior more product-like by grounding the read in outlets that are updated continuously without needing manual refresh work from you. The visible app badge was bumped to Version 10 so this newspaper-filtered testing state is easy to identify.

### Version 11
Date: 2026-05-25

Summary: This version makes the short-read source line optionally clickable so you can open the cited article directly from the rest card.

Changes and ideas: The read card now turns the source line into a link when a source URL is available, so the newspaper label is no longer just a passive hint. This makes it easier to verify what the live read was grounded on without forcing that extra step every time. The interaction stays optional and lightweight: if there is no source URL, the card still shows plain source text, and if the link cannot be opened the rest timer continues without interruption. The visible app badge was bumped to Version 11 so this trust-oriented UI change is easy to identify while testing.

### Version 12
Date: 2026-05-25

Summary: This version makes the web-search read flow stricter about recency and adds topic-lane rotation on top of outlet rotation.

Changes and ideas: The live read prompt now explicitly asks for a story from today when possible, otherwise from the last 72 hours, and asks the model to base the card on one specific article instead of drifting into a generic overview. On top of the rotating newspaper groups, the app now also rotates across topic lanes such as business, science, regulation, consumer tech, and internet culture so the read stream does not collapse into the same kind of story every time. Source labels are also shown only when the model actually returned a cited URL, which removes some misleading cases where the UI could imply a newspaper source without a clickable article behind it. The visible app badge was bumped to Version 12 so this stricter testing state is easy to spot.

### Version 13
Date: 2026-05-25

Summary: This version makes source links more reliable on the web-search read path by asking the model to return the article URL directly in the JSON.

Changes and ideas: The web-search read prompt now asks for `sourceName` and `sourceUrl` alongside the read content so the app does not depend only on optional tool annotations to show a clickable article. This is a practical fix for the current model path, where the read text could come back fine but the tool metadata was sometimes sparse enough that the link disappeared. The read flow still prefers recent reporting, still rotates outlet groups and topic lanes, and now has a better fallback path for preserving traceability when the model does search-backed summarization. The visible app badge was bumped to Version 13 so this source-link reliability change is clear while testing.

### Version 14
Date: 2026-05-26

Summary: This version cleans up leaked links in the read body, makes the writing easier to follow, and preloads the next live item so the next rest can start faster.

Changes and ideas: The short-read prompts now ask for plainer, more vivid language that stays factual without sounding academic, and they explicitly tell the model to explain or avoid unfamiliar abbreviations instead of assuming the reader already knows them. Read bodies are also sanitized before rendering so markdown-style links or raw URLs do not spill awkwardly into the paragraph text. To reduce waiting, the app now fetches one live item ahead in the background and holds it out of repetition history until it is actually shown, which means the next rest can often use that prefetched content immediately while another item starts loading behind the scenes. The source-label handling was also tightened so model-provided source names are preserved when a valid source URL exists, which helps the optional article link appear more reliably. The visible app badge was bumped to Version 14 so this readability and preload pass is easy to identify while testing.

### Version 15
Date: 2026-05-28

Summary: This version turns fun facts into quick quiz-first prompts and adds two in-rest controls for getting another read or extending the timer a little.

Changes and ideas: Fun facts now arrive as small memory hooks instead of plain statements alone: the card first asks a quick multiple-choice or true-or-false question, then reveals the fact after you tap, which should make the content more interactive and easier to remember. The immersive rest screen now also lets you ask for another read without stopping the countdown, which is useful when you finish a card early and want one more thing to look at, and it adds an "I need more rest" action that extends the timer by a small amount while the countdown keeps running. The visible app badge was bumped to Version 15 so this new rest-control and quiz-first state is easy to identify while testing.

### Version 16
Date: 2026-05-28

Summary: This version turns fact quizzes into real answer-selection interactions and strengthens read history by tracking what was shown and what was actually opened.

Changes and ideas: Fact cards no longer jump straight from a generic reveal button to the explanation. Instead, you now choose an answer first, get immediate feedback on that choice, and then see the explanation beneath it, which makes the quiz mechanic feel like an actual interaction rather than a relabeled reveal. On the read side, history tracking now stores normalized fingerprints and action types so the app can distinguish between content that was merely shown and content whose article link was actually opened, which gives the repetition controls more useful memory than plain titles alone. The visible app badge was bumped to Version 16 so this interaction and history pass is easy to identify while testing.

### Version 17
Date: 2026-05-28

Summary: This version adds named group rest reports, shows total rest per set more clearly, and gives fun facts the same follow-up path as reads.

Changes and ideas: The reset flow has been turned into a new-group action that preserves the previous block instead of wiping it silently. Each saved group now keeps the rest length for every completed set, plus the total and average rest time, and the active group can be renamed before it is saved into local history. During an active rest, the UI now shows the current set's total rest time directly, so adding extra time is visible immediately rather than feeling approximate. The follow-up content action also now works for fun facts through a dedicated "Know more" state, while read history has been simplified to care only about what was shown in the app rather than whether an external link was clicked. The visible app badge was bumped to Version 17 so this reporting-oriented pass is easy to identify while testing.

### Version 18
Date: 2026-05-28

Summary: This version makes fact quizzes less self-spoiling by hiding the fact title until after the first answer and locking the first choice in place.

Changes and ideas: Fun fact cards were still leaking too much before the user engaged, because the title could reveal the answer or narrow it down too aggressively. The quiz now shows a neutral pre-answer heading instead, and only reveals the actual title after the user has committed to a choice. The answer interaction was also tightened so the first tap is final for that card, which keeps the quiz from degenerating into trial-and-error tapping. The visible app badge was bumped to Version 18 so this quiz-discipline pass is easy to identify while testing.

### Version 19
Date: 2026-05-28

Summary: This version records actual elapsed rest in group history and adds a way to clear saved group reports.

Changes and ideas: Group reports were previously saving the planned rest target, which broke down as soon as a user ended a rest early or stretched a set unevenly. The report logic now commits the real elapsed time for each finished rest and surfaces that same elapsed time in the session metrics, while the immersive screen shows both elapsed time and planned total so extensions stay legible. The saved-groups section also now exposes a direct clear-history action, which resets local report storage without affecting the current active group. The visible app badge was bumped to Version 19 so this reporting-correction pass is easy to identify while testing.

### Version 20
Date: 2026-06-04

Summary: This version changes how "I need more rest" works, makes the setup panel collapsible, and cleans up the fact quiz interaction.

Changes and ideas: The "I need more rest" action no longer adds a fixed block of time and repeats. It now switches the rest into an open-ended mode where the countdown stops, the timer counts up as elapsed time, and the rest only ends when you manually tap End rest now. The button disappears once open-ended mode is active so there is no second tap needed. The actual elapsed time is what gets recorded in group history, so reports remain accurate regardless of how long an open-ended rest runs. The setup card for rest length and content type can now be collapsed by tapping the header, which keeps the screen tidier once the workflow is familiar. Finally, fact quiz cards now hide the choice buttons the moment a selection is made, and jump straight to showing the result, instead of leaving the disabled and color-coded chips on screen alongside the answer box. The visible app badge was bumped to Version 20 so this timer and UX pass is easy to identify while testing.

### Version 21
Date: 2026-06-10

Summary: This version adds a Study mode that lets users bring their own material and receive it in rest-timed, progressively delivered chunks.

Changes and ideas: A new Study mode was added alongside the existing Fact, Read, Teaser, and Game modes. When Study is selected, a setup panel appears in the Setup card where the user can type a short goal or topic (max 150 chars), paste a URL, pick a PDF from their device, or pick an image or screenshot. The AI reads whatever is provided and generates one focused content chunk per rest period, sized to fit the chosen rest duration. Each chunk is cached so revisiting the same chunk on the next rest requires no API call. The user taps Next to advance to the next chunk; without tapping Next the same chunk repeats on the following rest. A progress indicator shows the current part and estimated total. When all chunks are done the mode shows a completion state. An End Session button in the setup panel clears the material and plan so the user can load something new. URL content is fetched via the local news proxy using a new /api/fetch-url endpoint. PDFs are picked via expo-document-picker and sent to the model as base64. Images are picked via expo-image-picker. The three new packages (expo-document-picker, expo-image-picker, expo-file-system) were installed. The visible app badge was bumped to Version 21.

### Version 22
Date: 2026-06-11

Summary: This version fixes two runtime crashes introduced by Study mode on real iOS devices.

Changes and ideas: Two bugs appeared when running Study mode on device. First, `AbortSignal.timeout()` is not available in React Native's Hermes JavaScript engine (it is browser/Node-only), so all study content fetches crashed immediately with "AbortSignal.timeout is not a function". This was fixed by replacing both usages with a small helper that creates an `AbortController` and cancels it via `setTimeout`, which works correctly across all environments. Second, `FileSystem.EncodingType` from `expo-file-system` is undefined in Expo SDK 54 because the package was redesigned around a new `File`/`Directory` class API, making `readAsStringAsync` and its constants deprecated. PDF picking crashed with "Cannot read property 'Base64' of undefined" because the old `EncodingType.Base64` constant no longer exists. Both the deprecated constant and the deprecated import were fixed by switching the import to `expo-file-system/legacy`, which re-exports the full original API including `readAsStringAsync`, and by passing the encoding as the plain string `"base64"` rather than through the now-missing constant. The visible app badge was bumped to Version 22.

### Version 23
Date: 2026-06-13

Summary: This version fixes study mode content quality and the first-rest loading delay.

Changes and ideas: Three issues with study mode were addressed. First, content was repetitive because the prompt only passed previous chunk titles to the model, which gave it no real sense of what had already been explained. The service now passes the title and a body excerpt (up to 450 chars) for each of the last three chunks, and the system prompt explicitly instructs the model to treat each chunk as the next paragraph in a single coherent lesson — building on what came before, going deeper, and never re-introducing already-covered concepts. Second, nothing prefetched the next chunk while the user was reading the current one, so every Next tap triggered a fresh API call with a noticeable wait. Now, after any chunk is successfully fetched, the app immediately fires a silent background prefetch for the following chunk. The prefetch only updates the chunk cache and never blocks or interrupts the active rest. Third, the first rest in a study session always showed "Loading…" for most of its duration because the API call only started when the user tapped "Finish Set". A new useEffect now triggers a background prefetch for chunk 0 as soon as study mode is selected and settings are configured, so the content is typically ready before the first rest begins. The visible app badge was bumped to Version 23.

### Version 24
Date: 2026-06-14

Summary: This version substantially improves study mode content quality, adds Wikipedia images, and fixes the rest-duration stale-closure bug.

Changes and ideas: Four issues were addressed. First, content depth: the system prompt was overhauled to demand concrete, verifiable facts in every sentence — real names, real years, real decisions — and explicitly forbids the generic brand-overview language the model was defaulting to. It now instructs the model to choose one specific narrow angle per chunk (a product, an era, a person, an event) and build the entire chunk around that angle, as though briefing someone who already knows the basics and wants the interesting specific details. The angle is stored as a "focusAngle" field on each chunk and passed to subsequent prompts so the model can see exactly which angles have already been taken. Second, stronger anti-repetition: the previous-context window was expanded from 3 to 5 chunks, body excerpts increased from 450 to 600 chars, and a flat list of covered angles is now sent alongside the excerpts so the model has both the prose context and an explicit list of what not to cover. Third, Wikipedia images: the service now asks the model to return an optional "imageSearchQuery" (a concise term for a visually clear subject) and fires a parallel Wikipedia thumbnail fetch using that query. The image URL is stored on the chunk and displayed in the study content panel between the title and body, matching the existing layout from the short-read mode. Fourth, rest-duration bug: the prefetch callbacks were using a stale closure over the `restSeconds` value from the previous rest, causing all subsequent chunks to be sized for the original duration even after the user changed presets. A `selectedRestRef` is now kept in sync with `session.selectedRest` on every render, and all prefetch calls read from the ref instead of the stale closure. The `prefetchStudyChunk` signature was simplified to not take a `restSeconds` parameter at all. The visible app badge was bumped to Version 24.

## Current State

The current visible app badge is Version 24. Expo is pinned to port 8094, and the local news proxy is running on port 8787.