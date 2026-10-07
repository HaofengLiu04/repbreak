const STUDY_CHUNK_TIMEOUT_MS = 25000;

function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
      throw new Error("The model did not return valid JSON.");
    }

    return JSON.parse(text.slice(start, end + 1));
  }
}

async function fetchUrlText(url, newsEndpoint) {
  if (!newsEndpoint) {
    return null;
  }

  const fetchUrlEndpoint = newsEndpoint.replace("/api/news", "/api/fetch-url");

  try {
    const response = await fetch(
      `${fetchUrlEndpoint}?url=${encodeURIComponent(url)}`,
      { signal: timeoutSignal(12000) },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    return data.error ? null : (data.text || null);
  } catch {
    return null;
  }
}

// Fetch a representative image from Wikipedia for a search term.
// Returns a thumbnail URL string or null if nothing found.
async function fetchWikipediaImage(query) {
  if (!query?.trim()) {
    return null;
  }

  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query` +
      `&generator=search&gsrsearch=${encodeURIComponent(query.trim())}&gsrlimit=3` +
      `&prop=pageimages&pithumbsize=700&pilicense=any` +
      `&format=json&origin=*`;

    const response = await fetch(url, { signal: timeoutSignal(8000) });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pages = data?.query?.pages;

    if (!pages) {
      return null;
    }

    // Pick the first page that has a thumbnail
    const imageUrl = Object.values(pages)
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .map((p) => p?.thumbnail?.source)
      .find(Boolean);

    return imageUrl || null;
  } catch {
    return null;
  }
}

// previousChunks: array of { title, body, focusAngle? } for all chunks before this one
export async function fetchStudyChunk({
  setup,
  intent,
  restSeconds,
  chunkIndex,
  previousChunks = [],
  settings,
}) {
  if (!settings?.enabled || !settings?.apiKey?.trim() || !settings?.model?.trim()) {
    throw new Error(
      "AI settings are not configured. Add an API key and model in Fresh content setup.",
    );
  }

  const wordsPerChunk = Math.round(restSeconds * 2.2);

  // --- Resolve material text ---
  let materialText = "";

  if (setup.url?.trim()) {
    const fetched = await fetchUrlText(setup.url.trim(), settings.newsEndpoint);

    if (fetched) {
      materialText = `[From URL: ${setup.url.trim()}]\n\n${fetched.slice(0, 20000)}`;
    } else {
      materialText = `[URL provided: ${setup.url.trim()} — if you can access this URL, base your response on its content. If not, acknowledge it and work from the intent alone.]`;
    }
  }

  if (setup.text?.trim()) {
    materialText = materialText
      ? `${materialText}\n\n[Additional context: ${setup.text.trim()}]`
      : `[Topic / context: ${setup.text.trim()}]`;
  }

  // --- Build cumulative context (last 5 chunks with body excerpts + covered angles) ---
  const recentChunks = previousChunks.slice(-5);
  const coveredAngles = previousChunks
    .map((c) => c.focusAngle)
    .filter(Boolean)
    .map((a, i) => `${i + 1}. ${a}`)
    .join("\n");

  const prevContext =
    recentChunks.length > 0
      ? `\n\nThis is a progressive lesson. What has already been covered:\n${recentChunks
          .map(
            (c, i) =>
              `Part ${previousChunks.length - recentChunks.length + i + 1}${c.focusAngle ? ` [angle: ${c.focusAngle}]` : ""} — "${c.title}":\n${c.body.slice(0, 600)}${c.body.length > 600 ? "…" : ""}`,
          )
          .join("\n\n")}${coveredAngles ? `\n\nAngles already used:\n${coveredAngles}` : ""}\n\nDo NOT repeat, re-introduce, or summarise anything from the parts above. Pick a completely new angle that hasn't been covered yet and build part ${chunkIndex + 1} entirely around that.`
      : "";

  // --- Build system message ---
  const systemMessage =
    `You are a specialist research assistant delivering content inside a gym rest-timer app. ` +
    `The user has ${restSeconds} seconds between sets — make every word count.\n\n` +
    `Generate ONE chunk of content for part ${chunkIndex + 1} of a progressive deep-dive. ` +
    `Target approximately ${wordsPerChunk} words.\n\n` +
    `DEPTH RULES (strictly enforced):\n` +
    `- Every sentence must contain at least one concrete, verifiable fact: a real name, a real year, a real number, a real place, a specific decision or event.\n` +
    `- NEVER write vague generalities like "known for quality", "founded several decades ago", or "industry leader". If you catch yourself doing this, replace it with a specific fact.\n` +
    `- Write as if you are briefing someone who already knows the basics and wants the interesting, specific, lesser-known details.\n` +
    `- Interesting stories, surprising origins, pivotal decisions, notable failures, real people — these are gold.\n\n` +
    `CONTINUITY RULES:\n` +
    `- Treat each part as the next section of a single well-researched article, not a standalone piece.\n` +
    `- Do not re-introduce the subject. The reader already knows what it is from earlier parts.\n` +
    `- Build directly on the depth already established, going deeper or sideways into a new specific aspect.${prevContext}\n\n` +
    `Choose one specific, concrete angle for this chunk (a specific product, era, person, event, technology, or business decision). State it in "focusAngle".\n` +
    `Also provide an optional "imageSearchQuery": a concise Wikipedia-friendly search term (3–6 words) that would return a relevant, illustrative image for this chunk — only include it if there is a clearly relevant visual subject (skip for abstract topics).\n\n` +
    `Return only valid JSON: { "chunkTitle": string, "content": string, "focusAngle": string, "estimatedTotalChunks": number, "isLastChunk": boolean, "imageSearchQuery": string | null }`;

  // --- Build user message ---
  const intentLine = intent?.trim()
    ? `Goal: ${intent.trim()}`
    : "Goal: learn about and understand this material in depth";

  const textBlock = {
    type: "text",
    text: materialText ? `${intentLine}\n\nMaterial:\n${materialText}` : intentLine,
  };

  const userContentBlocks = [textBlock];

  if (setup.imageBase64) {
    userContentBlocks.push({
      type: "image_url",
      image_url: {
        url: `data:${setup.imageType || "image/jpeg"};base64,${setup.imageBase64}`,
      },
    });
  }

  if (setup.pdfBase64) {
    userContentBlocks.push({
      type: "file",
      file: {
        filename: setup.pdfFileName || "document.pdf",
        file_data: `data:application/pdf;base64,${setup.pdfBase64}`,
      },
    });
  }

  const userContent =
    userContentBlocks.length === 1 ? userContentBlocks[0].text : userContentBlocks;

  // --- API request + image fetch in parallel ---
  const apiPromise = fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    }),
    signal: timeoutSignal(STUDY_CHUNK_TIMEOUT_MS),
  });

  const response = await apiPromise;

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error("The model returned an empty response.");
  }

  const chunk = extractJson(rawContent);

  // Fetch Wikipedia image in parallel with returning the chunk (non-blocking)
  const imageUrl = await fetchWikipediaImage(chunk.imageSearchQuery).catch(() => null);

  return {
    title: String(chunk.chunkTitle || `Part ${chunkIndex + 1}`),
    body: String(chunk.content || ""),
    focusAngle: chunk.focusAngle ? String(chunk.focusAngle) : null,
    chunkIndex,
    estimatedTotalChunks: Number(chunk.estimatedTotalChunks) || null,
    isLastChunk: Boolean(chunk.isLastChunk),
    imageUrl: imageUrl || null,
  };
}
