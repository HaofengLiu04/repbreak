const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");

const PORT = Number(process.env.NEWS_PROXY_PORT || 8787);
const CACHE_TTL_MS = 5 * 60 * 1000;
const parser = new Parser({ timeout: 10000 });
const ARTICLE_USER_AGENT = "RepBreakNewsProxy/1.0 (+https://localhost)";
const IMAGE_ENRICH_LIMIT = 10;
const FEED_ITEMS_PER_SOURCE = 10;
const HN_ITEMS_LIMIT = 16;

const RSS_SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" },
  { name: "Engadget", url: "https://www.engadget.com/rss.xml" },
  { name: "VentureBeat", url: "https://venturebeat.com/feed/" },
  { name: "The Guardian Tech", url: "https://www.theguardian.com/uk/technology/rss" },
];

let cache = {
  expiresAt: 0,
  items: [],
};

const imageCache = new Map();

function collapseWhitespace(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function flattenMediaUrls(value) {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenMediaUrls(item));
  }

  if (typeof value === "object") {
    return [
      value.url,
      value.href,
      value?.$?.url,
      value?.$?.href,
      ...Object.values(value).flatMap((item) => flattenMediaUrls(item)),
    ].filter(Boolean);
  }

  return [];
}

function extractImageFromHtml(html) {
  if (!html) {
    return "";
  }

  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);

  return match?.[1] || "";
}

function resolveMaybeRelativeUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractMetaImageFromHtml(html, baseUrl) {
  if (!html) {
    return "";
  }

  const patterns = [
    /<meta[^>]+property=["']og:image[^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);

    if (match?.[1]) {
      const resolved = resolveMaybeRelativeUrl(match[1], baseUrl);

      if (resolved) {
        return resolved;
      }
    }
  }

  return resolveMaybeRelativeUrl(extractImageFromHtml(html), baseUrl);
}

function normalizeSearchTerms(title) {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "for",
    "in",
    "on",
    "with",
    "from",
    "how",
    "why",
    "is",
    "are",
    "was",
    "were",
    "this",
    "that",
    "it",
    "as",
    "at",
    "by",
  ]);

  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 6)
    .join(" ");
}

async function fetchArticleImage(url) {
  const cached = imageCache.get(url);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.imageUrl;
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": ARTICLE_USER_AGENT },
      redirect: "follow",
    });

    if (!response.ok) {
      imageCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, imageUrl: "" });
      return "";
    }

    const html = await response.text();
    const imageUrl = extractMetaImageFromHtml(html, response.url || url);

    imageCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, imageUrl });
    return imageUrl;
  } catch {
    imageCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, imageUrl: "" });
    return "";
  }
}

async function fetchCommonsImage(title) {
  const query = normalizeSearchTerms(title);

  if (!query) {
    return "";
  }

  try {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", "1");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url");
    url.searchParams.set("iiurlwidth", "900");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    const response = await fetch(url, {
      headers: { "User-Agent": ARTICLE_USER_AGENT },
    });

    if (!response.ok) {
      return "";
    }

    const payload = await response.json();
    const page = Object.values(payload?.query?.pages || {})[0];
    const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;

    return imageInfo?.thumburl || imageInfo?.url || "";
  } catch {
    return "";
  }
}

async function enrichItemImage(item) {
  if (item.imageUrl) {
    return item;
  }

  const articleImage = await fetchArticleImage(item.url);

  if (articleImage) {
    return {
      ...item,
      imageUrl: articleImage,
    };
  }

  const fallbackImage = await fetchCommonsImage(item.title);

  return {
    ...item,
    imageUrl: fallbackImage,
  };
}

function extractImageUrl(item) {
  return firstNonEmpty([
    ...flattenMediaUrls(item.enclosure),
    ...flattenMediaUrls(item["media:content"]),
    ...flattenMediaUrls(item["media:thumbnail"]),
    ...flattenMediaUrls(item["media:group"]),
    ...flattenMediaUrls(item.thumbnail),
    extractImageFromHtml(item["content:encoded"]),
    extractImageFromHtml(item.content),
  ]);
}

function normalizeUrlForDeduplication(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);

    parsed.hash = "";
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ].forEach((key) => parsed.searchParams.delete(key));

    return parsed.toString();
  } catch {
    return String(url);
  }
}

function dedupeItems(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();

  return items.filter((item) => {
    const normalizedUrl = normalizeUrlForDeduplication(item.url);
    const normalizedTitle = collapseWhitespace(item.title).toLowerCase();

    if ((normalizedUrl && seenUrls.has(normalizedUrl)) || seenTitles.has(normalizedTitle)) {
      return false;
    }

    if (normalizedUrl) {
      seenUrls.add(normalizedUrl);
    }

    seenTitles.add(normalizedTitle);
    return true;
  });
}

function interleaveBySource(items) {
  const groupedItems = new Map();

  for (const item of items) {
    const sourceItems = groupedItems.get(item.source) || [];
    sourceItems.push(item);
    groupedItems.set(item.source, sourceItems);
  }

  const orderedSources = Array.from(groupedItems.entries())
    .sort((left, right) => {
      const leftTime = left[1][0]?.publishedAt ? new Date(left[1][0].publishedAt).getTime() : 0;
      const rightTime = right[1][0]?.publishedAt ? new Date(right[1][0].publishedAt).getTime() : 0;

      return rightTime - leftTime;
    })
    .map(([source]) => source);

  const mixedItems = [];
  let added = true;

  while (added) {
    added = false;

    for (const source of orderedSources) {
      const sourceItems = groupedItems.get(source);

      if (sourceItems?.length) {
        mixedItems.push(sourceItems.shift());
        added = true;
      }
    }
  }

  return mixedItems;
}

function normalizeRssItem(sourceName, item) {
  const title = collapseWhitespace(item.title);
  const summary = collapseWhitespace(
    item.contentSnippet || item.summary || item.content || item["content:encoded"] || "",
  );

  if (!title || !item.link) {
    return null;
  }

  return {
    title,
    source: sourceName,
    url: item.link,
    publishedAt: normalizeDate(item.isoDate || item.pubDate),
    summary: summary.slice(0, 280),
    imageUrl: extractImageUrl(item),
  };
}

async function fetchRssSource(source) {
  const feed = await parser.parseURL(source.url);

  return (feed.items || [])
    .slice(0, FEED_ITEMS_PER_SOURCE)
    .map((item) => normalizeRssItem(source.name, item))
    .filter(Boolean);
}

async function fetchHackerNewsSource() {
  const idResponse = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");

  if (!idResponse.ok) {
    throw new Error(`Hacker News request failed with ${idResponse.status}`);
  }

  const ids = (await idResponse.json()).slice(0, HN_ITEMS_LIMIT);
  const itemResponses = await Promise.allSettled(
    ids.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)),
  );

  const items = [];

  for (const response of itemResponses) {
    if (response.status !== "fulfilled" || !response.value.ok) {
      continue;
    }

    const item = await response.value.json();
    const title = collapseWhitespace(item.title);

    if (!title || !item.url) {
      continue;
    }

    items.push({
      title,
      source: "Hacker News",
      url: item.url,
      publishedAt: normalizeDate(item.time ? item.time * 1000 : null),
      summary: collapseWhitespace(item.text || "").slice(0, 280),
      imageUrl: "",
    });
  }

  return items;
}

async function getFreshItems() {
  if (cache.expiresAt > Date.now() && cache.items.length > 0) {
    return cache.items;
  }

  const results = await Promise.allSettled([
    ...RSS_SOURCES.map((source) => fetchRssSource(source)),
    fetchHackerNewsSource(),
  ]);

  const items = interleaveBySource(
    dedupeItems(
      results
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value)
        .filter((item) => item && item.title && item.url)
        .sort((left, right) => {
          const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
          const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;

          return rightTime - leftTime;
        }),
    ),
  );

  const enrichedItems = await Promise.all(
    items.map((item, index) => (index < IMAGE_ENRICH_LIMIT ? enrichItemImage(item) : Promise.resolve(item))),
  );

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    items: enrichedItems,
  };

  return enrichedItems;
}

const app = express();

app.use(cors());

app.get("/health", (_request, response) => {
  response.json({ ok: true, port: PORT });
});

app.get("/api/news", async (request, response) => {
  const limit = Math.min(20, Math.max(1, Number(request.query.limit || 10)));

  try {
    const items = await getFreshItems();

    response.json({
      updatedAt: new Date().toISOString(),
      itemCount: Math.min(limit, items.length),
      items: items.slice(0, limit),
    });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : "News fetch failed.",
    });
  }
});

app.get("/api/fetch-url", async (request, response) => {
  const { url } = request.query;

  if (!url) {
    return response.status(400).json({ error: "url parameter required" });
  }

  try {
    const fetchResponse = await fetch(url, {
      headers: { "User-Agent": ARTICLE_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    if (!fetchResponse.ok) {
      return response.status(400).json({ error: `HTTP ${fetchResponse.status}` });
    }

    const html = await fetchResponse.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40000);

    response.json({ url, text });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch URL" });
  }
});

app.listen(PORT, () => {
  console.log(`News proxy listening on http://localhost:${PORT}`);
});