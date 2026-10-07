import { loadJson, saveJson } from "./storage";

const READ_HISTORY_STORAGE_KEY = "repbreak-live-read-history";
const FACT_HISTORY_STORAGE_KEY = "repbreak-live-fact-history";
const MAX_HISTORY_ITEMS = 24;
const NEWS_FETCH_TIMEOUT_MS = 2500;
const LIVE_CONTENT_TIMEOUT_MS = 15000;
const NEWS_POOL_LIMIT = 30;
const RECENT_SOURCE_BLOCK_COUNT = 3;
const OPENAI_HOSTNAME = "api.openai.com";
const WEB_SEARCH_PUBLICATION_GROUPS = [
  {
    label: "Reuters and AP",
    domains: ["reuters.com", "apnews.com"],
    names: ["Reuters", "Associated Press"],
  },
  {
    label: "New York Times and Washington Post",
    domains: ["nytimes.com", "washingtonpost.com"],
    names: ["The New York Times", "The Washington Post"],
  },
  {
    label: "Wall Street Journal and Bloomberg",
    domains: ["wsj.com", "bloomberg.com"],
    names: ["The Wall Street Journal", "Bloomberg"],
  },
  {
    label: "The Guardian and Financial Times",
    domains: ["theguardian.com", "ft.com"],
    names: ["The Guardian", "Financial Times"],
  },
];
const WEB_SEARCH_FILTER_MODELS = ["gpt-5.5"];
const WEB_SEARCH_TOPIC_LANES = [
  { key: "business", label: "business and markets" },
  { key: "science", label: "science and research" },
  { key: "regulation", label: "policy and regulation" },
  { key: "consumer-tech", label: "consumer tech and products" },
  { key: "internet-culture", label: "internet culture and online platforms" },
];

function stripMarkdownLinks(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1")
    .replace(/\((https?:\/\/[^\s)]+)\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "");
}

function sanitizeReadText(text) {
  return stripMarkdownLinks(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getReadSegmentCount(totalSeconds, focusWindow) {
  const readingWindow = Math.max(1, totalSeconds - focusWindow);

  if (readingWindow <= 24) {
    return 1;
  }

  if (readingWindow <= 36) {
    return 2;
  }

  if (readingWindow <= 54) {
    return 3;
  }

  return 4;
}

function getFactSentenceCount(totalSeconds, focusWindow) {
  const readingWindow = Math.max(1, totalSeconds - focusWindow);

  if (readingWindow <= 20) {
    return 2;
  }

  if (readingWindow <= 36) {
    return 3;
  }

  return 4;
}

function getFactWordTarget(totalSeconds, focusWindow) {
  const readingWindow = Math.max(1, totalSeconds - focusWindow);

  if (readingWindow <= 20) {
    return 34;
  }

  if (readingWindow <= 36) {
    return 52;
  }

  return 72;
}

function normalizeSimilarityText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeReadUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);

    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "source"].forEach(
      (key) => url.searchParams.delete(key),
    );

    return url.toString();
  } catch {
    return String(value).trim();
  }
}

function buildReadFingerprint(item) {
  return normalizeReadUrl(item?.url) || normalizeSimilarityText(item?.title);
}

function upsertReadHistoryEntry(history, entry) {
  const fingerprint = buildReadFingerprint(entry);
  const nextItems = [
    {
      title: entry.title || "",
      url: normalizeReadUrl(entry.url),
      source: entry.source || "",
      topicLane: entry.topicLane || "",
      fingerprint,
    },
    ...history.filter((item) => buildReadFingerprint(item) !== fingerprint),
  ];

  return nextItems;
}

function findPublicationGroupByHostname(hostname) {
  if (!hostname) {
    return null;
  }

  return (
    WEB_SEARCH_PUBLICATION_GROUPS.find((group) =>
      group.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
    ) || null
  );
}

function choosePublicationGroup(recentReads) {
  const recentHostnames = recentReads
    .slice(0, RECENT_SOURCE_BLOCK_COUNT)
    .map((item) => getHostname(item.url))
    .filter(Boolean);
  const availableGroups = WEB_SEARCH_PUBLICATION_GROUPS.filter(
    (group) => !group.domains.some((domain) => recentHostnames.some((hostname) => hostname === domain || hostname.endsWith(`.${domain}`))),
  );
  const pool = availableGroups.length > 0 ? availableGroups : WEB_SEARCH_PUBLICATION_GROUPS;

  return pool[Math.floor(Math.random() * pool.length)] || WEB_SEARCH_PUBLICATION_GROUPS[0];
}

function deriveCitationSourceLabel(citation, publicationGroup) {
  const hostname = getHostname(citation?.url);
  const matchedGroup = findPublicationGroupByHostname(hostname);

  if (matchedGroup?.names?.[0]) {
    return matchedGroup.names[0];
  }

  return publicationGroup?.names?.[0] || publicationGroup?.label || citation?.title || "";
}

function chooseTopicLane(recentReads) {
  const recentLaneKeys = new Set(
    recentReads.slice(0, RECENT_SOURCE_BLOCK_COUNT).map((item) => item.topicLane).filter(Boolean),
  );
  const availableLanes = WEB_SEARCH_TOPIC_LANES.filter((lane) => !recentLaneKeys.has(lane.key));
  const pool = availableLanes.length > 0 ? availableLanes : WEB_SEARCH_TOPIC_LANES;

  return pool[Math.floor(Math.random() * pool.length)] || WEB_SEARCH_TOPIC_LANES[0];
}

function isOpenAiEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname === OPENAI_HOSTNAME;
  } catch {
    return false;
  }
}

function supportsWebSearchFilters(model) {
  const normalizedModel = String(model || "").toLowerCase();

  return WEB_SEARCH_FILTER_MODELS.some((prefix) => normalizedModel.startsWith(prefix));
}

function buildResponsesEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    url.pathname = "/v1/responses";
    url.search = "";
    return url.toString();
  } catch {
    return "https://api.openai.com/v1/responses";
  }
}

async function loadHistory(key) {
  const history = await loadJson(key, []);

  return Array.isArray(history) ? history : [];
}

async function saveHistory(key, history) {
  await saveJson(key, history.slice(0, MAX_HISTORY_ITEMS));
}

function buildRecentFactContext(recentFacts) {
  if (!Array.isArray(recentFacts) || recentFacts.length === 0) {
    return "";
  }

  const items = recentFacts
    .slice(0, 6)
    .map((item, index) => `${index + 1}. ${item.title}: ${item.body}`)
    .join("\n");

  return `Avoid repeating or lightly rewording these recent facts:\n${items}`;
}

function buildRecentReadContext(recentReads) {
  if (!Array.isArray(recentReads) || recentReads.length === 0) {
    return "";
  }

  const items = recentReads
    .slice(0, 6)
    .map((item, index) => {
      const source = item.source ? ` [${item.source}]` : "";
      const topicLane = item.topicLane ? ` (${item.topicLane})` : "";

      return `${index + 1}. ${item.title}${source}${topicLane}`;
    })
    .join("\n");

  return `Do not reuse these recently shown stories or near-duplicate angles:\n${items}`;
}

function chooseNewsItem(newsItems, recentReads) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return null;
  }

  const recentUrls = new Set(recentReads.map((item) => normalizeReadUrl(item.url)).filter(Boolean));
  const recentFingerprints = new Set(recentReads.map((item) => buildReadFingerprint(item)).filter(Boolean));
  const recentTitles = new Set(
    recentReads.map((item) => normalizeSimilarityText(item.title)).filter(Boolean),
  );
  const recentSources = new Set(recentReads.slice(0, RECENT_SOURCE_BLOCK_COUNT).map((item) => item.source).filter(Boolean));

  const unseenItems = newsItems.filter((item) => {
    const normalizedTitle = normalizeSimilarityText(item.title);
    const fingerprint = buildReadFingerprint(item);

    return !recentUrls.has(normalizeReadUrl(item.url)) && !recentTitles.has(normalizedTitle) && !recentFingerprints.has(fingerprint);
  });

  const avoidRecentSource = (items) => items.filter((item) => !recentSources.has(item.source));
  const preferredUnseenItems = avoidRecentSource(unseenItems);
  const fallbackDifferentSourceItems = avoidRecentSource(newsItems);
  const pool = (
    preferredUnseenItems.length > 0
      ? preferredUnseenItems
      : unseenItems.length > 0
        ? unseenItems
        : fallbackDifferentSourceItems.length > 0
          ? fallbackDifferentSourceItems
          : newsItems
  ).slice(0, 16);

  return pool[Math.floor(Math.random() * pool.length)] || newsItems[0];
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("The model did not return JSON.");
    }

    return JSON.parse(text.slice(start, end + 1));
  }
}

function buildNewsContext(newsItem) {
  if (!newsItem) {
    return "";
  }

  const publishedAt = newsItem.publishedAt ? `, ${newsItem.publishedAt}` : "";
  const summary = newsItem.summary ? ` Summary: ${newsItem.summary}` : "";

  return `Base the read on this specific recent item. Stay grounded in the provided details and do not invent article claims or fake sources.\n[${newsItem.source}${publishedAt}] ${newsItem.title}.${summary}`;
}

async function fetchNewsItems(settings) {
  const newsEndpoint = settings.newsEndpoint?.trim();

  if (!newsEndpoint) {
    return [];
  }

  try {
    const url = new URL(newsEndpoint);
    url.searchParams.set("limit", String(NEWS_POOL_LIMIT));

    const response = await fetchWithTimeout(url.toString(), {}, NEWS_FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();

    if (!Array.isArray(payload?.items)) {
      return [];
    }

    return payload.items
      .map((item) => ({
        title: String(item.title || ""),
        source: String(item.source || "Unknown"),
        url: item.url ? String(item.url) : "",
        topicLane: item.topicLane ? String(item.topicLane) : "",
        publishedAt: item.publishedAt ? String(item.publishedAt) : "",
        summary: item.summary ? String(item.summary) : "",
        imageUrl: item.imageUrl ? String(item.imageUrl) : "",
      }))
      .filter((item) => item.title);
  } catch {
    return [];
  }
}

function buildPrompt(mode, totalSeconds, focusWindow, settings, options = {}) {
  const recentFacts = options.recentFacts || [];
  const recentReads = options.recentReads || [];
  const selectedNewsItem = options.selectedNewsItem || null;
  const useWebSearch = Boolean(options.useWebSearch);
  const publicationGroup = options.publicationGroup || null;
  const topicLane = options.topicLane || null;

  if (mode === "fact") {
    const sentenceCount = getFactSentenceCount(totalSeconds, focusWindow);
    const wordTarget = getFactWordTarget(totalSeconds, focusWindow);

    return {
      system:
        settings.factPrompt ||
        "You write one short, fresh, gym-safe fun fact for a rest timer app. Return only JSON.",
      user:
        `Return JSON with keys title, body, question, options, answer, quizType, and lengthLabel. The body must be exactly ${sentenceCount} sentence${sentenceCount === 1 ? "" : "s"} and roughly ${wordTarget} words total. question must be a quick quiz prompt that helps the user think before revealing the fact. quizType must be either "multiple-choice" or "true-false". If quizType is "true-false", options must be ["True", "False"]. If quizType is "multiple-choice", options must contain exactly 3 short choices and one of them must match answer exactly. Keep it useful, fresh, varied, and easy to read in under ${Math.max(8, totalSeconds - focusWindow)} seconds. Each sentence should add a concrete point rather than repeating itself. Prefer a distinct angle from common workout trivia. ${buildRecentFactContext(recentFacts)} Avoid markdown.`,
    };
  }

  const segmentCount = getReadSegmentCount(totalSeconds, focusWindow);

  if (useWebSearch) {
    const outletNames = publicationGroup?.names?.join(" and ") || "major news outlets";
    const laneLabel = topicLane?.label || "technology, business, science, consumer products, startups, regulation, or internet culture";

    return {
      system:
        settings.readPrompt ||
        "You write micro reading cards for a gym rest timer app. Use web search when needed and return only JSON.",
      user:
          `Search only within ${outletNames} for one genuinely recent ${laneLabel} story. Prefer something published today; if nothing strong is available, use the last 72 hours, and avoid anything older unless absolutely necessary. Avoid returning the same story, company, angle, or topic lane as the recent reads listed below. Base the read on one specific article, not a blended overview. Return only JSON with keys title, segments, lengthLabel, sourceName, and sourceUrl. segments must be an array of exactly ${segmentCount} short paragraphs. sourceName must be the publication name for the specific article you used. sourceUrl must be the exact article URL you used. The read should fit a ${totalSeconds}-second rest with a ${focusWindow}-second refocus window. Write in plain English, make it colorful and easy to follow, and keep it fact-first without sounding academic. If you mention an abbreviation or acronym that a general reader may not know, spell it out on first mention or avoid it entirely. Do not include markdown, raw URLs, citation markers, or any text outside the JSON object. ${buildRecentReadContext(recentReads)}`,
    };
  }

  return {
    system:
      settings.readPrompt ||
      "You write micro reading cards for a gym rest timer app. Return only JSON.",
    user:
      `Return JSON with keys title, segments, and lengthLabel. segments must be an array of exactly ${segmentCount} short paragraphs. The read should fit a ${totalSeconds}-second rest with a ${focusWindow}-second refocus window. ${buildNewsContext(selectedNewsItem) || "If your model or endpoint has live web access, prefer a very recent tech, business, science, or internet-culture development and keep it grounded in real reporting. If it does not, do not claim to have browsed or cite made-up coverage."} ${buildRecentReadContext(recentReads)} Avoid markdown and keep the tone crisp, original, and readable during a workout.`,
  };
}

function normalizeContent(mode, payload, totalSeconds, focusWindow, options = {}) {
  if (mode === "fact") {
    if (!payload?.title || !payload?.body) {
      throw new Error("The live fact response was missing title or body.");
    }

    const sentenceCount = getFactSentenceCount(totalSeconds, focusWindow);

    return {
      title: String(payload.title),
      body: String(payload.body),
      question: String(payload.question || "Quick guess before the fact:"),
      options: Array.isArray(payload.options)
        ? payload.options.slice(0, 3).map((option) => String(option))
        : ["True", "False"],
      answer: String(payload.answer || ""),
      quizType: payload.quizType === "true-false" ? "true-false" : "multiple-choice",
      lengthLabel:
        payload.lengthLabel ||
        `${sentenceCount} sentence${sentenceCount === 1 ? "" : "s"} for a ${totalSeconds}s rest`,
    };
  }

  const segmentCount = getReadSegmentCount(totalSeconds, focusWindow);
  const segments = Array.isArray(payload?.segments)
    ? payload.segments.slice(0, segmentCount).map((segment) => sanitizeReadText(segment))
    : [];

  if (!payload?.title || segments.length === 0) {
    throw new Error("The live read response was missing title or segments.");
  }

  return {
    title: sanitizeReadText(payload.title),
    segments,
    source:
      options.selectedNewsItem?.source ||
      (payload.sourceName ? String(payload.sourceName) : "") ||
      options.searchCitation?.title ||
      "",
    sourceUrl:
      options.selectedNewsItem?.url ||
      (payload.sourceUrl ? String(payload.sourceUrl) : "") ||
      options.searchCitation?.url ||
      "",
    publishedAt: options.selectedNewsItem?.publishedAt || "",
    imageUrl: options.selectedNewsItem?.imageUrl || "",
    lengthLabel:
      payload.lengthLabel ||
      `${segments.length} ${segments.length === 1 ? "chunk" : "chunks"} for a ${totalSeconds}s rest`,
  };
}

function extractResponseOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const message = Array.isArray(payload?.output)
    ? payload.output.find((item) => item?.type === "message")
    : null;
  const contentItem = Array.isArray(message?.content)
    ? message.content.find((item) => typeof item?.text === "string")
    : null;

  return contentItem?.text || "";
}

function extractWebCitation(payload) {
  const message = Array.isArray(payload?.output)
    ? payload.output.find((item) => item?.type === "message")
    : null;

  for (const contentItem of message?.content || []) {
    for (const annotation of contentItem?.annotations || []) {
      if (annotation?.type === "url_citation" && annotation.url) {
        return {
          title: annotation.title || "",
          url: annotation.url,
        };
      }
    }
  }

  const webSearchCall = Array.isArray(payload?.output)
    ? payload.output.find((item) => item?.type === "web_search_call")
    : null;
  const firstSource = Array.isArray(webSearchCall?.action?.sources)
    ? webSearchCall.action.sources[0]
    : null;

  if (firstSource?.url) {
    return {
      title: firstSource.title || "",
      url: firstSource.url,
    };
  }

  return null;
}

function describeRequestError(error, endpoint) {
  const trimmedEndpoint = endpoint.trim();

  if (error?.name === "AbortError") {
    return new Error("The live content request timed out. Try again in a few seconds.");
  }

  if (error?.message === "Failed to fetch") {
    if (trimmedEndpoint.includes("api.openai.com")) {
      return new Error(
        "OpenAI's direct API is blocked by browser CORS in web preview. Keep using the saved key, but switch to a CORS-enabled proxy endpoint for localhost or test the native app."
      );
    }

    return new Error(
      "The live content endpoint could not be reached from this browser. If you are testing on web, use a CORS-enabled endpoint or try the native app."
    );
  }

  return error;
}

async function fetchReadContentWithWebSearch({ totalSeconds, focusWindow, settings, recentReads }) {
  const publicationGroup = choosePublicationGroup(recentReads);
  const topicLane = chooseTopicLane(recentReads);
  const canUseDomainFilters = supportsWebSearchFilters(settings.model.trim());
  const prompt = buildPrompt("read", totalSeconds, focusWindow, settings, {
    recentReads,
    useWebSearch: true,
    publicationGroup,
    topicLane,
  });
  let response;

  try {
    response = await fetchWithTimeout(
      buildResponsesEndpoint(settings.endpoint.trim()),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.model.trim(),
          tools: [
            canUseDomainFilters
              ? {
                  type: "web_search",
                  search_context_size: "low",
                  filters: {
                    allowed_domains: publicationGroup.domains,
                  },
                }
              : {
                  type: "web_search",
                  search_context_size: "low",
                },
          ],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
          input: `${prompt.system}\n\n${prompt.user}`,
        }),
      },
      LIVE_CONTENT_TIMEOUT_MS,
    );
  } catch (error) {
    throw describeRequestError(error, settings.endpoint);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Live content request failed with ${response.status}.`);
  }

  const payload = await response.json();
  const modelText = extractResponseOutputText(payload);

  if (!modelText) {
    throw new Error("The live read response did not include text.");
  }

  const normalizedContent = normalizeContent(
    "read",
    extractJson(modelText),
    totalSeconds,
    focusWindow,
    {
      searchCitation: extractWebCitation(payload),
    },
  );

  const citation = extractWebCitation(payload);
  const sourceLabel = citation?.url ? deriveCitationSourceLabel(citation, publicationGroup) : "";

  const finalizedContent = {
    ...normalizedContent,
    source: sourceLabel || (normalizedContent.sourceUrl ? normalizedContent.source : ""),
    sourceUrl: citation?.url || normalizedContent.sourceUrl,
    topicLane: topicLane.key,
  };

  if (settings.commitHistory !== false) {
    await saveHistory(
      READ_HISTORY_STORAGE_KEY,
      upsertReadHistoryEntry(recentReads, {
        title: finalizedContent.title,
        url: finalizedContent.sourceUrl,
        source: finalizedContent.source,
        topicLane: finalizedContent.topicLane,
      }),
    );
  }

  return finalizedContent;
}

export async function recordFreshContentHistory({ mode, content }) {
  if (mode === "read" && content?.title) {
    const recentReads = await loadHistory(READ_HISTORY_STORAGE_KEY);
    await saveHistory(
      READ_HISTORY_STORAGE_KEY,
      upsertReadHistoryEntry(recentReads, {
        title: content.title,
        url: content.sourceUrl || "",
        source: content.source || "",
        topicLane: content.topicLane || "",
      }),
    );
  }

  if (mode === "fact" && content?.title && content?.body) {
    const recentFacts = await loadHistory(FACT_HISTORY_STORAGE_KEY);
    await saveHistory(FACT_HISTORY_STORAGE_KEY, [
      {
        title: content.title,
        body: content.body,
      },
      ...recentFacts,
    ]);
  }
}

export async function fetchFreshContent({ mode, totalSeconds, focusWindow, settings, commitHistory = true }) {
  if (!["fact", "read"].includes(mode)) {
    return null;
  }

  if (!settings.enabled || !settings.apiKey.trim() || !settings.model.trim()) {
    return null;
  }

  const [recentReads, recentFacts, newsItems] = await Promise.all([
    loadHistory(READ_HISTORY_STORAGE_KEY),
    loadHistory(FACT_HISTORY_STORAGE_KEY),
    mode === "read" ? fetchNewsItems(settings) : Promise.resolve([]),
  ]);

  if (mode === "read" && isOpenAiEndpoint(settings.endpoint.trim())) {
    return fetchReadContentWithWebSearch({
      totalSeconds,
      focusWindow,
      settings: {
        ...settings,
        commitHistory,
      },
      recentReads,
    });
  }

  const selectedNewsItem = mode === "read" ? chooseNewsItem(newsItems, recentReads) : null;
  const prompt = buildPrompt(mode, totalSeconds, focusWindow, settings, {
    recentReads,
    recentFacts,
    selectedNewsItem,
  });
  let response;

  try {
    response = await fetchWithTimeout(
      settings.endpoint.trim(),
      {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model.trim(),
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
      },
      LIVE_CONTENT_TIMEOUT_MS,
    );
  } catch (error) {
    throw describeRequestError(error, settings.endpoint);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Live content request failed with ${response.status}.`);
  }

  const payload = await response.json();
  const modelText = payload?.choices?.[0]?.message?.content;

  if (!modelText) {
    throw new Error("The live content response did not include a message.");
  }

  const normalizedContent = normalizeContent(mode, extractJson(modelText), totalSeconds, focusWindow, {
    selectedNewsItem,
  });

  if (commitHistory && mode === "read" && selectedNewsItem) {
    await saveHistory(
      READ_HISTORY_STORAGE_KEY,
      upsertReadHistoryEntry(recentReads, {
        title: selectedNewsItem.title,
        url: selectedNewsItem.url,
        source: selectedNewsItem.source,
        topicLane: selectedNewsItem.topicLane || "",
      }),
    );
  }

  if (commitHistory && mode === "fact") {
    await saveHistory(FACT_HISTORY_STORAGE_KEY, [
      {
        title: normalizedContent.title,
        body: normalizedContent.body,
      },
      ...recentFacts,
    ]);
  }

  return normalizedContent;
}