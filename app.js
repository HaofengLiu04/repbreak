import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from "react-native";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

import {
  buildContent,
  computeFocusWindow,
  modeLabels,
  resolveMode,
} from "./src/data/content";
import { fetchFreshContent, recordFreshContentHistory } from "./src/services/aiContent";
import { fetchStudyChunk } from "./src/services/studyContent";
import { loadJson, saveJson } from "./src/services/storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";

const REST_PRESETS = [30, 45, 60, 90, 120];
const GAME_BOARD_HEIGHT = 230;
const BALL_SIZE = 16;
const TARGET_SIZE = 14;
const PADDLE_HEIGHT = 12;
const RULES_STORAGE_KEY = "repbreak-rules-dismissed";
const AI_SETTINGS_STORAGE_KEY = "repbreak-ai-settings";
const REST_REPORTS_STORAGE_KEY = "repbreak-rest-reports";
const APP_BUILD_LABEL = "Version 24";
const MAX_REST_REPORTS = 24;
const DEFAULT_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || "";
const LEGACY_READ_PROMPT =
  "You write a short rest-timer reading card about the latest AI news, research, product launches, and industry trends. Keep it accurate, current-sounding, crisp, and easy to read during a workout. Return only JSON.";
const LEGACY_FACT_PROMPT =
  "You write one short, useful workout-related fact for a gym rest timer app. Focus on training, recovery, exercise science, nutrition, or biomechanics. Return only JSON.";
const DEFAULT_READ_PROMPT =
  "You write a short rest-timer reading card about major recent developments in technology, business, science, consumer products, startups, regulation, or internet culture. If the model or endpoint has live web access, ground the piece in genuinely recent coverage. If it does not, do not pretend to have browsed; keep it current-feeling without inventing sources. Return only JSON.";
const DEFAULT_FACT_PROMPT =
  "You write one short, useful, surprising fun fact for a rest timer app. Rotate across exercise science, recovery, nutrition, biomechanics, neuroscience, sports, health, food science, and everyday science. Keep it gym-safe, concrete, and quick to read. Return only JSON.";
const DEFAULT_AI_SETTINGS = {
  enabled: true,
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  apiKey: DEFAULT_API_KEY,
  readPrompt: DEFAULT_READ_PROMPT,
  factPrompt: DEFAULT_FACT_PROMPT,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));

  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getAverageRestSeconds(restDurations) {
  if (!Array.isArray(restDurations) || restDurations.length === 0) {
    return 0;
  }

  const total = restDurations.reduce((sum, value) => sum + value, 0);

  return Math.round(total / restDurations.length);
}

function getNextGroupName(reportCount) {
  return `Group ${reportCount + 1}`;
}

function buildRestReport(groupName, restDurations) {
  const safeDurations = Array.isArray(restDurations)
    ? restDurations.map((value) => Math.max(0, Math.round(Number(value) || 0))).filter(Boolean)
    : [];

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: groupName.trim() || "Untitled group",
    createdAt: new Date().toISOString(),
    restDurations: safeDurations,
    setCount: safeDurations.length,
    totalRestSeconds: safeDurations.reduce((sum, value) => sum + value, 0),
    averageRestSeconds: getAverageRestSeconds(safeDurations),
  };
}

function getElapsedRestSeconds(current, now = Date.now()) {
  if (!current?.restStartedAt) {
    return current?.actualRestSeconds ?? 0;
  }

  const elapsedSeconds = Math.round((now - current.restStartedAt) / 1000);

  if (current.openEndedRest) {
    return Math.max(0, elapsedSeconds);
  }

  return clamp(elapsedSeconds, 0, current.totalSeconds || elapsedSeconds);
}

function commitRestForGroup(current) {
  if (current.currentRestCommitted) {
    return current;
  }

  const actualRestSeconds = getElapsedRestSeconds(current);

  return {
    ...current,
    actualRestSeconds,
    currentRestCommitted: true,
    groupRestDurations: [...current.groupRestDurations, actualRestSeconds],
  };
}

function normalizeAiSettings(settings) {
  const normalizedReadPrompt = settings?.readPrompt?.trim();
  const normalizedFactPrompt = settings?.factPrompt?.trim();

  return {
    ...DEFAULT_AI_SETTINGS,
    ...settings,
    enabled: settings?.enabled ?? DEFAULT_AI_SETTINGS.enabled,
    endpoint: settings?.endpoint?.trim() || DEFAULT_AI_SETTINGS.endpoint,
    model: settings?.model?.trim() || DEFAULT_AI_SETTINGS.model,
    apiKey: settings?.apiKey?.trim() || DEFAULT_AI_SETTINGS.apiKey,
    readPrompt:
      !normalizedReadPrompt || normalizedReadPrompt === LEGACY_READ_PROMPT
        ? DEFAULT_READ_PROMPT
        : normalizedReadPrompt,
    factPrompt:
      !normalizedFactPrompt || normalizedFactPrompt === LEGACY_FACT_PROMPT
        ? DEFAULT_FACT_PROMPT
        : normalizedFactPrompt,
  };
}

function createInitialSession() {
  return {
    selectedRest: 30,
    selectedMode: "random",
    groupName: "Group 1",
    groupRestDurations: [],
    completedSets: 0,
    phase: "idle",
    remaining: 30,
    totalSeconds: 30,
    focusWindow: computeFocusWindow(30),
    currentMode: null,
    currentContent: null,
    answerRevealed: false,
    selectedQuizChoice: null,
    quizAnsweredCorrectly: null,
    actualRestSeconds: null,
    currentRestCommitted: true,
    restStartedAt: null,
    restEndsAt: null,
    openEndedRest: false,
    gameId: 0,
    restRequestId: 0,
    contentSource: "local",
    contentError: null,
  };
}

function createObstacleLayout(boardWidth, boardHeight) {
  return [
    {
      x: boardWidth * 0.1,
      y: boardHeight * 0.18,
      width: boardWidth * 0.28,
      height: 12,
    },
    {
      x: boardWidth * 0.54,
      y: boardHeight * 0.32,
      width: boardWidth * 0.24,
      height: 12,
    },
    {
      x: boardWidth * 0.24,
      y: boardHeight * 0.5,
      width: boardWidth * 0.34,
      height: 12,
    },
  ];
}

function circleIntersectsRect(centerX, centerY, radius, rect) {
  const nearestX = clamp(centerX, rect.x, rect.x + rect.width);
  const nearestY = clamp(centerY, rect.y, rect.y + rect.height);
  const dx = centerX - nearestX;
  const dy = centerY - nearestY;

  return dx * dx + dy * dy <= radius * radius;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function openExternalUrl(url) {
  if (!url) {
    return;
  }

  try {
    await Linking.openURL(url);
  } catch {
    // Ignore failed open attempts so the rest timer UI stays uninterrupted.
  }
}

function createTarget(boardWidth, boardHeight, obstacles) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const target = {
      x: randomBetween(18, boardWidth - TARGET_SIZE - 18),
      y: randomBetween(18, boardHeight * 0.6),
      size: TARGET_SIZE,
    };

    const centerX = target.x + target.size / 2;
    const centerY = target.y + target.size / 2;
    const blocked = obstacles.some((obstacle) =>
      circleIntersectsRect(centerX, centerY, target.size / 2 + 10, obstacle),
    );

    if (!blocked) {
      return target;
    }
  }

  return {
    x: boardWidth * 0.72,
    y: boardHeight * 0.16,
    size: TARGET_SIZE,
  };
}

function createGameState(boardWidth, boardHeight) {
  const paddleWidth = Math.min(92, boardWidth * 0.28);
  const obstacles = createObstacleLayout(boardWidth, boardHeight);

  return {
    boardWidth,
    boardHeight,
    paddleWidth,
    paddleX: (boardWidth - paddleWidth) / 2,
    paddleY: boardHeight - 22,
    ball: {
      x: boardWidth * 0.36,
      y: boardHeight * 0.62,
      vx: 2.7,
      vy: -2.45,
      size: BALL_SIZE,
    },
    target: createTarget(boardWidth, boardHeight, obstacles),
    obstacles,
    score: 0,
  };
}

function advanceGame(game) {
  const radius = game.ball.size / 2;
  let nextBall = {
    ...game.ball,
    x: game.ball.x + game.ball.vx,
    y: game.ball.y + game.ball.vy,
  };

  if (nextBall.x <= 0 || nextBall.x + nextBall.size >= game.boardWidth) {
    nextBall.vx *= -1;
    nextBall.x = clamp(nextBall.x, 0, game.boardWidth - nextBall.size);
  }

  if (nextBall.y <= 0) {
    nextBall.vy = Math.abs(nextBall.vy);
    nextBall.y = 0;
  }

  const paddle = {
    x: game.paddleX,
    y: game.paddleY,
    width: game.paddleWidth,
    height: PADDLE_HEIGHT,
  };

  const hitsPaddle =
    nextBall.vy > 0 &&
    nextBall.y + nextBall.size >= paddle.y &&
    nextBall.y <= paddle.y + paddle.height &&
    nextBall.x + nextBall.size >= paddle.x &&
    nextBall.x <= paddle.x + paddle.width;

  if (hitsPaddle) {
    const ballCenterX = nextBall.x + radius;
    const paddleCenterX = paddle.x + paddle.width / 2;
    const normalizedImpact = (ballCenterX - paddleCenterX) / (paddle.width / 2);

    nextBall.vx = clamp(normalizedImpact * 3.8, -4.1, 4.1);
    nextBall.vy = -Math.max(2.5, Math.abs(nextBall.vy));
    nextBall.y = paddle.y - nextBall.size - 1;
  } else if (nextBall.y + nextBall.size >= game.boardHeight) {
    nextBall = {
      ...nextBall,
      x: game.boardWidth * 0.38,
      y: game.boardHeight * 0.6,
      vx: nextBall.vx >= 0 ? -2.7 : 2.7,
      vy: -2.6,
    };
  }

  const centerX = nextBall.x + radius;
  const centerY = nextBall.y + radius;

  for (const obstacle of game.obstacles) {
    if (!circleIntersectsRect(centerX, centerY, radius, obstacle)) {
      continue;
    }

    const overlapX = Math.min(
      centerX - obstacle.x,
      obstacle.x + obstacle.width - centerX,
    );
    const overlapY = Math.min(
      centerY - obstacle.y,
      obstacle.y + obstacle.height - centerY,
    );

    if (overlapX < overlapY) {
      nextBall.vx *= -1;
      nextBall.x += nextBall.vx > 0 ? 3 : -3;
    } else {
      nextBall.vy *= -1;
      nextBall.y += nextBall.vy > 0 ? 3 : -3;
    }

    break;
  }

  const ballCenterX = nextBall.x + radius;
  const ballCenterY = nextBall.y + radius;
  const targetCenterX = game.target.x + game.target.size / 2;
  const targetCenterY = game.target.y + game.target.size / 2;
  const dx = ballCenterX - targetCenterX;
  const dy = ballCenterY - targetCenterY;
  const targetHitDistance = radius + game.target.size / 2;

  if (dx * dx + dy * dy <= targetHitDistance * targetHitDistance) {
    return {
      ...game,
      ball: nextBall,
      target: createTarget(game.boardWidth, game.boardHeight, game.obstacles),
      score: game.score + 1,
    };
  }

  return {
    ...game,
    ball: nextBall,
  };
}

function isFocusPhase(session) {
  if (session.openEndedRest) return false;
  return session.phase === "resting" && session.remaining <= session.focusWindow;
}

function PillButton({ active, label, onPress, disabled }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pillButton,
        active && styles.pillButtonActive,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pillButtonPressed,
      ]}
    >
      <Text style={[styles.pillButtonText, active && styles.pillButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function App() {
  const [session, setSession] = useState(createInitialSession);
  const [restReports, setRestReports] = useState([]);
  const [boardSize, setBoardSize] = useState({ width: 320, height: GAME_BOARD_HEIGHT });
  const [game, setGame] = useState(() => createGameState(320, GAME_BOARD_HEIGHT));
  const [rulesDismissed, setRulesDismissed] = useState(false);
  const [showRulesReview, setShowRulesReview] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiSettings, setAiSettings] = useState(DEFAULT_AI_SETTINGS);
  const [aiDraft, setAiDraft] = useState(DEFAULT_AI_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [studySetup, setStudySetup] = useState({
    text: "", url: "", imageBase64: null, imageType: null,
    pdfBase64: null, pdfFileName: null, parseError: null,
  });
  const [studyIntent, setStudyIntent] = useState("");
  const [studyPlan, setStudyPlan] = useState({
    currentChunkIndex: 0, estimatedTotalChunks: null, chunks: [], done: false,
  });
  const contentRequestRef = useRef(0);
  const prefetchedContentRef = useRef(null);
  const prefetchRequestRef = useRef(0);
  // Always reflects session.selectedRest so prefetch callbacks use the current preset
  const selectedRestRef = useRef(0);
  selectedRestRef.current = session.selectedRest;

  function buildLiveContentKey({ mode, totalSeconds, focusWindow }) {
    return JSON.stringify({
      mode,
      totalSeconds,
      focusWindow,
      endpoint: aiSettings.endpoint.trim(),
      model: aiSettings.model.trim(),
      readPrompt: aiSettings.readPrompt,
      factPrompt: aiSettings.factPrompt,
    });
  }

  function clearPrefetchedContent() {
    prefetchedContentRef.current = null;
    prefetchRequestRef.current = 0;
  }

  function prefetchNextLiveContent({ mode, totalSeconds, focusWindow }) {
    if (!['read', 'fact'].includes(mode)) {
      return;
    }

    if (!aiSettings.enabled || !aiSettings.apiKey.trim() || !aiSettings.model.trim()) {
      return;
    }

    const cacheKey = buildLiveContentKey({ mode, totalSeconds, focusWindow });

    if (prefetchedContentRef.current?.key === cacheKey) {
      return;
    }

    const requestToken = Date.now();
    prefetchRequestRef.current = requestToken;

    fetchFreshContent({
      mode,
      totalSeconds,
      focusWindow,
      settings: aiSettings,
      commitHistory: false,
    })
      .then((freshContent) => {
        if (!freshContent || prefetchRequestRef.current !== requestToken) {
          return;
        }

        prefetchedContentRef.current = {
          key: cacheKey,
          content: freshContent,
        };
      })
      .catch(() => {
        if (prefetchRequestRef.current === requestToken) {
          prefetchedContentRef.current = null;
        }
      });
  }

  useEffect(() => {
    let isCancelled = false;

    async function hydrateSettings() {
      const [storedRulesDismissed, storedAiSettings, storedRestReports] = await Promise.all([
        loadJson(RULES_STORAGE_KEY, false),
        loadJson(AI_SETTINGS_STORAGE_KEY, DEFAULT_AI_SETTINGS),
        loadJson(REST_REPORTS_STORAGE_KEY, []),
      ]);

      if (isCancelled) {
        return;
      }

      const mergedSettings = normalizeAiSettings(storedAiSettings);
      const normalizedReports = Array.isArray(storedRestReports) ? storedRestReports : [];

      setRulesDismissed(Boolean(storedRulesDismissed));
      setAiSettings(mergedSettings);
      setAiDraft(mergedSettings);
      setRestReports(normalizedReports);
      setSession((current) => {
        if (current.completedSets !== 0 || current.groupRestDurations.length > 0 || current.groupName !== "Group 1") {
          return current;
        }

        return {
          ...current,
          groupName: getNextGroupName(normalizedReports.length),
        };
      });
      setSettingsHydrated(true);
    }

    hydrateSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session.phase !== "resting" || !session.restEndsAt) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      const millisecondsLeft = session.restEndsAt - Date.now();

      if (millisecondsLeft <= 0) {
        clearInterval(intervalId);
        setSession((current) => {
          if (current.phase !== "resting") {
            return current;
          }

          const committedSession = commitRestForGroup(current);

          return {
            ...committedSession,
            phase: "alert",
            remaining: 0,
            restStartedAt: null,
            restEndsAt: null,
          };
        });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Vibration.vibrate([180, 100, 220]);
        return;
      }

      const nextValue = Math.max(0, Math.ceil(millisecondsLeft / 1000));

      setSession((current) => {
        if (current.phase !== "resting" || current.remaining === nextValue) {
          return current;
        }

        return {
          ...current,
          remaining: nextValue,
        };
      });
    }, 200);

    return () => clearInterval(intervalId);
  }, [session.phase, session.restEndsAt]);

  useEffect(() => {
    if (session.phase !== "resting" || !session.openEndedRest || !session.restStartedAt) {
      return undefined;
    }

    const startedAt = session.restStartedAt;
    const intervalId = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      setSession((current) => {
        if (current.phase !== "resting" || !current.openEndedRest) {
          return current;
        }

        return { ...current, remaining: elapsed };
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [session.phase, session.openEndedRest, session.restStartedAt]);

  // Pre-fetch study chunk 0 as soon as study mode is selected and setup has content,
  // so the first rest doesn't have to wait for the API call.
  useEffect(() => {
    if (session.selectedMode !== "study") return;
    if (!settingsHydrated || !aiSettings.enabled || !aiSettings.apiKey?.trim()) return;
    if (studyPlan.chunks[0]) return; // already cached
    if (!studyIntent?.trim() && !studySetup.url?.trim() && !studySetup.imageBase64 && !studySetup.pdfBase64) return;

    prefetchStudyChunk(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.selectedMode,
    studyPlan.chunks[0],   // re-run after clearStudySession empties slot 0
    settingsHydrated,
    aiSettings.enabled,
    aiSettings.apiKey,
  ]);

  useEffect(() => {
    if (session.phase !== "resting" || session.currentMode !== "game") {
      return undefined;
    }

    setGame(createGameState(boardSize.width, boardSize.height));
    return undefined;
  }, [boardSize.height, boardSize.width, session.currentMode, session.gameId, session.phase]);

  const focusPhase = isFocusPhase(session);

  useEffect(() => {
    if (session.phase !== "resting" || session.currentMode !== "game" || focusPhase) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setGame((current) => advanceGame(current));
    }, 24);

    return () => clearInterval(intervalId);
  }, [focusPhase, session.currentMode, session.phase]);

  function updateRest(seconds) {
    if (session.phase === "resting") {
      return;
    }

    setSession((current) => ({
      ...current,
      selectedRest: seconds,
      remaining: seconds,
      totalSeconds: seconds,
      focusWindow: computeFocusWindow(seconds),
      currentMode: current.phase === "alert" ? current.currentMode : null,
      currentContent: current.phase === "alert" ? current.currentContent : null,
      answerRevealed: false,
      selectedQuizChoice: null,
      quizAnsweredCorrectly: null,
      actualRestSeconds: current.phase === "alert" ? current.actualRestSeconds : null,
      currentRestCommitted: current.phase === "resting" ? current.currentRestCommitted : true,
    }));
  }

  function updateGroupName(value) {
    setSession((current) => ({
      ...current,
      groupName: value,
    }));
  }

  function updateMode(mode) {
    setSession((current) => ({
      ...current,
      selectedMode: mode,
    }));
  }

  async function dismissRulesForever() {
    setRulesDismissed(true);
    setShowRulesReview(false);
    await saveJson(RULES_STORAGE_KEY, true);
  }

  async function saveAiConfiguration() {
    const nextSettings = normalizeAiSettings(aiDraft);

    clearPrefetchedContent();
    setAiDraft(nextSettings);
    setAiSettings(nextSettings);
    await saveJson(AI_SETTINGS_STORAGE_KEY, nextSettings);
  }

  async function clearAiConfiguration() {
    clearPrefetchedContent();
    setAiDraft(DEFAULT_AI_SETTINGS);
    setAiSettings(DEFAULT_AI_SETTINGS);
    await saveJson(AI_SETTINGS_STORAGE_KEY, DEFAULT_AI_SETTINGS);
  }

  function requestLiveContent({ requestId, mode, totalSeconds, focusWindow }) {
    if (!["fact", "read"].includes(mode)) {
      return;
    }

    if (!aiSettings.enabled || !aiSettings.apiKey.trim() || !aiSettings.model.trim()) {
      return;
    }

    const cacheKey = buildLiveContentKey({ mode, totalSeconds, focusWindow });
    const cachedContent = prefetchedContentRef.current?.key === cacheKey
      ? prefetchedContentRef.current.content
      : null;

    if (cachedContent) {
      prefetchedContentRef.current = null;

      setSession((current) => {
        if (
          current.restRequestId !== requestId ||
          current.phase !== "resting" ||
          current.currentMode !== mode
        ) {
          return current;
        }

        return {
          ...current,
          currentContent: cachedContent,
          contentSource: "live",
          contentError: null,
        };
      });

      void recordFreshContentHistory({ mode, content: cachedContent });
      prefetchNextLiveContent({ mode, totalSeconds, focusWindow });
      return;
    }

    setSession((current) => {
      if (current.restRequestId !== requestId) {
        return current;
      }

      return {
        ...current,
        contentSource: "live-loading",
        contentError: null,
      };
    });

    fetchFreshContent({
      mode,
      totalSeconds,
      focusWindow,
      settings: aiSettings,
      commitHistory: false,
    })
      .then((freshContent) => {
        if (!freshContent) {
          return;
        }

        setSession((current) => {
          if (
            current.restRequestId !== requestId ||
            current.phase !== "resting" ||
            current.currentMode !== mode
          ) {
            return current;
          }

          return {
            ...current,
            currentContent: freshContent,
            contentSource: "live",
            contentError: null,
          };
        });

        void recordFreshContentHistory({ mode, content: freshContent });
        prefetchNextLiveContent({ mode, totalSeconds, focusWindow });
      })
      .catch((error) => {
        setSession((current) => {
          if (current.restRequestId !== requestId) {
            return current;
          }

          return {
            ...current,
            contentSource: "local",
            contentError: error.message || "Live content request failed.",
          };
        });
      });
  }

  function startRest() {
    const focusWindow = computeFocusWindow(session.selectedRest);
    const currentMode = resolveMode(session.selectedMode);
    const isStudy = currentMode === "study";
    const cachedStudyChunk = isStudy ? studyPlan.chunks[studyPlan.currentChunkIndex] : null;
    const currentContent = isStudy
      ? (cachedStudyChunk || buildContent("study", session.selectedRest, focusWindow))
      : buildContent(currentMode, session.selectedRest, focusWindow);
    const requestId = Date.now();
    const restStartedAt = Date.now();
    contentRequestRef.current = requestId;

    setSession((current) => ({
      ...current,
      completedSets: current.completedSets + 1,
      phase: "resting",
      remaining: current.selectedRest,
      totalSeconds: current.selectedRest,
      focusWindow,
      currentMode,
      currentContent,
      answerRevealed: false,
      selectedQuizChoice: null,
      quizAnsweredCorrectly: null,
      actualRestSeconds: null,
      currentRestCommitted: false,
      openEndedRest: false,
      restStartedAt,
      restEndsAt: restStartedAt + current.selectedRest * 1000,
      gameId: currentMode === "game" ? current.gameId + 1 : current.gameId,
      restRequestId: requestId,
      contentSource: isStudy ? (cachedStudyChunk ? "live" : "live-loading") : "local",
      contentError: null,
    }));

    if (isStudy && !cachedStudyChunk) {
      requestStudyChunk(requestId, studyPlan.currentChunkIndex, session.selectedRest);
    } else if (!isStudy) {
      requestLiveContent({
        requestId,
        mode: currentMode,
        totalSeconds: session.selectedRest,
        focusWindow,
      });
    }
  }

  function endRestNow() {
    setSession((current) => {
      if (current.phase !== "resting") {
        return current;
      }

      const committedSession = commitRestForGroup(current);

      return {
        ...committedSession,
        phase: "alert",
        remaining: 0,
        openEndedRest: false,
        restStartedAt: null,
        restEndsAt: null,
      };
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([120, 80, 140]);
  }

  function dismissAlert() {
    setSession((current) => ({
      ...current,
      phase: "idle",
      currentMode: null,
      currentContent: null,
      answerRevealed: false,
      selectedQuizChoice: null,
      quizAnsweredCorrectly: null,
      actualRestSeconds: null,
      currentRestCommitted: true,
      restStartedAt: null,
      restEndsAt: null,
      openEndedRest: false,
      remaining: current.selectedRest,
      totalSeconds: current.selectedRest,
      restRequestId: 0,
      contentSource: "local",
      contentError: null,
    }));
  }

  async function resetSetCount() {
    if (session.phase === "resting") {
      return;
    }

    const trimmedGroupName = session.groupName.trim();
    const shouldSaveReport = session.groupRestDurations.length > 0;
    const nextReports = shouldSaveReport
      ? [
          buildRestReport(trimmedGroupName || getNextGroupName(restReports.length), session.groupRestDurations),
          ...restReports,
        ].slice(0, MAX_REST_REPORTS)
      : restReports;

    if (shouldSaveReport) {
      setRestReports(nextReports);
      await saveJson(REST_REPORTS_STORAGE_KEY, nextReports);
    }

    const nextGroupName = getNextGroupName(nextReports.length);

    setSession((current) => ({
      ...current,
      groupName: nextGroupName,
      groupRestDurations: [],
      completedSets: 0,
      phase: "idle",
      currentMode: null,
      currentContent: null,
      answerRevealed: false,
      selectedQuizChoice: null,
      quizAnsweredCorrectly: null,
      actualRestSeconds: null,
      currentRestCommitted: true,
      restStartedAt: null,
      restEndsAt: null,
      openEndedRest: false,
      remaining: current.selectedRest,
      totalSeconds: current.selectedRest,
      restRequestId: 0,
      contentSource: "local",
      contentError: null,
    }));
  }

  async function clearRestHistory() {
    setRestReports([]);
    await saveJson(REST_REPORTS_STORAGE_KEY, []);
  }

  function onPrimaryAction() {
    if (session.phase === "idle") {
      startRest();
      return;
    }

    if (session.phase === "alert") {
      dismissAlert();
    }
  }

  function revealAnswer() {
    setSession((current) => ({
      ...current,
      answerRevealed: true,
    }));
  }

  function chooseQuizAnswer(option) {
    setSession((current) => {
      if (current.selectedQuizChoice) {
        return current;
      }

      const answer = current.currentContent?.answer;

      return {
        ...current,
        selectedQuizChoice: option,
        quizAnsweredCorrectly: answer ? option === answer : null,
        answerRevealed: true,
      };
    });
  }

  function requestMoreContent() {
    if (session.phase !== "resting" || !["read", "fact"].includes(session.currentMode)) {
      return;
    }

    const mode = session.currentMode;
    const requestId = Date.now();
    contentRequestRef.current = requestId;
    const fallbackContent = buildContent(mode, session.totalSeconds, session.focusWindow);

    setSession((current) => {
      if (current.phase !== "resting" || current.currentMode !== mode) {
        return current;
      }

      return {
        ...current,
        currentContent: fallbackContent,
        answerRevealed: false,
        selectedQuizChoice: null,
        quizAnsweredCorrectly: null,
        restRequestId: requestId,
        contentSource: "local",
        contentError: null,
      };
    });

    requestLiveContent({
      requestId,
      mode,
      totalSeconds: session.totalSeconds,
      focusWindow: session.focusWindow,
    });
  }

  function addMoreRest() {
    setSession((current) => {
      if (current.phase !== "resting" || current.openEndedRest) {
        return current;
      }

      return {
        ...current,
        openEndedRest: true,
        restEndsAt: null,
      };
    });
  }

  function prefetchStudyChunk(chunkIndex) {
    // Quick bail using current render's snapshot; setStudyPlan updater below provides the hard guard
    if (studyPlan.chunks[chunkIndex]) {
      return;
    }

    const previousChunks = studyPlan.chunks
      .slice(0, chunkIndex)
      .filter(Boolean)
      .map((c) => ({ title: c.title, body: c.body, focusAngle: c.focusAngle }));

    fetchStudyChunk({
      setup: studySetup,
      intent: studyIntent,
      restSeconds: selectedRestRef.current,
      chunkIndex,
      previousChunks,
      settings: aiSettings,
    })
      .then((chunk) => {
        setStudyPlan((current) => {
          if (current.chunks[chunkIndex]) {
            return current; // race-condition guard: another fetch already filled this slot
          }

          const newChunks = [...current.chunks];
          newChunks[chunkIndex] = chunk;

          return {
            ...current,
            estimatedTotalChunks: chunk.estimatedTotalChunks || current.estimatedTotalChunks,
            chunks: newChunks,
          };
        });
      })
      .catch(() => {
        // prefetch failures are silent — the slot will be fetched on demand
      });
  }

  function requestStudyChunk(requestId, chunkIndex, restSeconds) {
    const previousChunks = studyPlan.chunks
      .slice(0, chunkIndex)
      .filter(Boolean)
      .map((c) => ({ title: c.title, body: c.body, focusAngle: c.focusAngle }));

    fetchStudyChunk({
      setup: studySetup,
      intent: studyIntent,
      restSeconds,
      chunkIndex,
      previousChunks,
      settings: aiSettings,
    })
      .then((chunk) => {
        if (contentRequestRef.current !== requestId) {
          return;
        }

        const isDone = chunk.isLastChunk && chunkIndex >= (chunk.estimatedTotalChunks ?? 0) - 1;

        setStudyPlan((current) => {
          const merged = [...current.chunks];
          merged[chunkIndex] = chunk;

          return {
            ...current,
            currentChunkIndex: chunkIndex,
            estimatedTotalChunks: chunk.estimatedTotalChunks || current.estimatedTotalChunks,
            chunks: merged,
            done: isDone,
          };
        });

        setSession((current) => {
          if (current.restRequestId !== requestId) {
            return current;
          }

          return {
            ...current,
            currentContent: chunk,
            contentSource: "live",
            contentError: null,
          };
        });

        // Pre-fetch the next chunk using the user's current rest preset
        if (!isDone) {
          prefetchStudyChunk(chunkIndex + 1);
        }
      })
      .catch((error) => {
        if (contentRequestRef.current !== requestId) {
          return;
        }

        setSession((current) => {
          if (current.restRequestId !== requestId) {
            return current;
          }

          return {
            ...current,
            contentSource: "local",
            contentError: error.message || "Failed to load study content.",
          };
        });
      });
  }

  function handleStudyNext() {
    if (studyPlan.done) {
      return;
    }

    const nextIndex = studyPlan.currentChunkIndex + 1;

    if (
      studyPlan.estimatedTotalChunks !== null &&
      nextIndex >= studyPlan.estimatedTotalChunks
    ) {
      setStudyPlan((current) => ({ ...current, done: true }));
      return;
    }

    const cachedChunk = studyPlan.chunks[nextIndex];

    if (cachedChunk) {
      setStudyPlan((current) => ({ ...current, currentChunkIndex: nextIndex }));
      setSession((current) => ({
        ...current,
        currentContent: cachedChunk,
        contentSource: "live",
        contentError: null,
      }));
      // Prefetch one step ahead while the user reads the cached chunk
      prefetchStudyChunk(nextIndex + 1);
      return;
    }

    const requestId = Date.now();
    contentRequestRef.current = requestId;

    setStudyPlan((current) => ({ ...current, currentChunkIndex: nextIndex }));
    setSession((current) => ({
      ...current,
      contentSource: "live-loading",
      contentError: null,
      restRequestId: requestId,
    }));

    requestStudyChunk(requestId, nextIndex, session.totalSeconds);
  }

  async function pickPDF() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: "base64",
      });

      setStudySetup((current) => ({
        ...current,
        pdfBase64: base64,
        pdfFileName: asset.name,
        imageBase64: null,
        imageType: null,
        url: "",
        parseError: null,
      }));
    } catch (error) {
      setStudySetup((current) => ({
        ...current,
        parseError: error.message || "Could not load PDF.",
      }));
    }
  }

  async function pickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        base64: true,
        quality: 0.8,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      setStudySetup((current) => ({
        ...current,
        imageBase64: asset.base64,
        imageType: asset.mimeType || "image/jpeg",
        pdfBase64: null,
        pdfFileName: null,
        url: "",
        parseError: null,
      }));
    } catch (error) {
      setStudySetup((current) => ({
        ...current,
        parseError: error.message || "Could not load image.",
      }));
    }
  }

  function clearStudySession() {
    setStudySetup({
      text: "", url: "", imageBase64: null, imageType: null,
      pdfBase64: null, pdfFileName: null, parseError: null,
    });
    setStudyIntent("");
    setStudyPlan({ currentChunkIndex: 0, estimatedTotalChunks: null, chunks: [], done: false });
  }

  function updatePaddle(locationX) {
    setGame((current) => ({
      ...current,
      paddleX: clamp(
        locationX - current.paddleWidth / 2,
        0,
        current.boardWidth - current.paddleWidth,
      ),
    }));
  }

  function handleBoardLayout(event) {
    const width = Math.max(280, Math.floor(event.nativeEvent.layout.width));

    setBoardSize((current) => {
      if (current.width === width && current.height === GAME_BOARD_HEIGHT) {
        return current;
      }

      return {
        width,
        height: GAME_BOARD_HEIGHT,
      };
    });
  }

  const progressRatio = session.openEndedRest ? 0 : (session.totalSeconds ? session.remaining / session.totalSeconds : 1);
  const immersiveRest = session.phase === "resting";
  const currentRestDisplaySeconds =
    session.phase === "resting"
      ? getElapsedRestSeconds(session)
      : session.actualRestSeconds;
  const currentGroupDurations =
    session.phase === "resting" && !session.currentRestCommitted
      ? [...session.groupRestDurations, currentRestDisplaySeconds]
      : session.groupRestDurations;
  const currentGroupAverage = getAverageRestSeconds(currentGroupDurations);
  const latestSavedReport = restReports[0] || null;

  let phasePill = "Ready";
  let headline = `Do set ${session.completedSets + 1}, then start rest.`;
  let subcopy = "The app is timer-first: one micro-item appears after your set, then the ending forces you back into the session.";
  let primaryLabel = `I finished set ${session.completedSets + 1}`;
  let phaseDetail = "Waiting for set";
  let liveStatus = "Live content is ready with the bundled default key.";

  if (session.phase === "resting") {
    phasePill = focusPhase ? "Refocus" : "Resting";
    headline = focusPhase ? "Next set starts soon." : `Rest after set ${session.completedSets}`;
    subcopy = focusPhase
      ? "The distraction is cut off now so the timer can steer you back into the lift."
      : `One ${modeLabels[session.currentMode].toLowerCase()} is active for this rest period.`;
    primaryLabel = "Rest running";
    phaseDetail = focusPhase ? "Closing content window" : `Showing ${modeLabels[session.currentMode]}`;
  }

  if (session.phase === "alert") {
    phasePill = "Go";
    headline = `Rest is over. Start set ${session.completedSets + 1}.`;
    subcopy = "Dismiss this prompt and get back to the workout. When that set is done, tap again to begin the next rest.";
    primaryLabel = "Dismiss and lift";
    phaseDetail = `Start set ${session.completedSets + 1}`;
  }

  if (!aiDraft.enabled) {
    liveStatus = "Live content is turned off. Enable it to request fresh reads and facts.";
  } else if (!aiDraft.apiKey.trim()) {
    liveStatus = `No API key is available on this ${Platform.OS === "web" ? "browser" : "device"}.`;
  } else if (!aiDraft.endpoint.trim()) {
    liveStatus = "No endpoint is set for live content.";
  } else if (!aiDraft.model.trim()) {
    liveStatus = "No model is set for live content.";
  } else if (session.contentSource === "live-loading") {
    liveStatus = `Requesting fresh ${session.currentMode === "fact" ? "fact" : "read"} content now.`;
  } else if (session.contentError) {
    liveStatus = `Last live request: ${session.contentError}`;
  } else {
    liveStatus = `Ready to call ${aiDraft.model} at ${aiDraft.endpoint}.`;
  }

  function renderContentPanel(immersive = false) {
    if (session.phase === "idle") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>How it behaves</Text>
          <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
            Built for the dead zone between sets
          </Text>
          <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
            Pick a rest length, choose a content type, and tap when a set ends. This mobile build
            shows one short item, then locks back onto the workout when the timer expires.
          </Text>
        </View>
      );
    }

    if (focusPhase || session.phase === "alert") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>Workout mode</Text>
          <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
            {session.phase === "alert" ? "The rest window is over" : "Wrap up the distraction"}
          </Text>
          <View style={styles.focusBox}>
            <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
              {session.phase === "alert"
                ? "This is the hard stop. The micro-content is frozen so the next set stays the priority."
                : `Final ${session.focusWindow} seconds: breathe, reset your stance, and get ready for the next set.`}
            </Text>
          </View>
        </View>
      );
    }

    if (session.currentMode === "fact") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>Fun fact</Text>
          <View style={styles.contentMetaRow}>
            <Text style={styles.metaBadge}>
              {session.contentSource === "live"
                ? "Live"
                : session.contentSource === "live-loading"
                  ? "Refreshing"
                  : "Library"}
            </Text>
            {session.contentSource === "live-loading" && (
              <ActivityIndicator color="#2f5d49" size="small" />
            )}
          </View>
          <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
            {session.answerRevealed ? session.currentContent.title : "Make your guess first"}
          </Text>
          {session.currentContent.lengthLabel ? (
            <Text style={styles.hintText}>{session.currentContent.lengthLabel}</Text>
          ) : null}
          {session.currentContent.question ? (
            <Text style={[styles.promptText, immersive && styles.immersivePromptText]}>
              {session.currentContent.question}
            </Text>
          ) : null}
          {Array.isArray(session.currentContent.options) && session.currentContent.options.length > 0 && !session.selectedQuizChoice ? (
            <View style={styles.quizOptionsWrap}>
              {session.currentContent.options.map((option) => (
                <Pressable
                  key={option}
                  disabled={Boolean(session.selectedQuizChoice)}
                  onPress={() => chooseQuizAnswer(option)}
                  style={({ pressed }) => [
                    styles.quizOptionChip,
                    session.selectedQuizChoice === option && styles.quizOptionChipSelected,
                    session.answerRevealed && option === session.currentContent.answer && styles.quizOptionChipCorrect,
                    session.answerRevealed &&
                    session.selectedQuizChoice === option &&
                    option !== session.currentContent.answer &&
                    styles.quizOptionChipWrong,
                    session.selectedQuizChoice && styles.disabledButton,
                    pressed && !session.selectedQuizChoice && styles.pillButtonPressed,
                  ]}
                >
                  <Text style={styles.quizOptionText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {session.answerRevealed && (
            <View style={styles.answerBox}>
              <Text style={styles.answerText}>
                {session.quizAnsweredCorrectly
                  ? `Correct: ${session.currentContent.answer}`
                  : `Answer: ${session.currentContent.answer}`}
              </Text>
              {session.selectedQuizChoice ? (
                <Text style={styles.hintText}>
                  {session.quizAnsweredCorrectly
                    ? "Nice. You got it right before the explanation."
                    : `You picked ${session.selectedQuizChoice}.`}
                </Text>
              ) : null}
              <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
                {session.currentContent.body}
              </Text>
            </View>
          )}
          {session.contentError ? <Text style={styles.errorText}>{session.contentError}</Text> : null}
        </View>
      );
    }

    if (session.currentMode === "read") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>Short read</Text>
          <View style={styles.contentMetaRow}>
            <Text style={styles.metaBadge}>
              {session.contentSource === "live"
                ? "Live"
                : session.contentSource === "live-loading"
                  ? "Refreshing"
                  : "Library"}
            </Text>
            {session.contentSource === "live-loading" && (
              <ActivityIndicator color="#2f5d49" size="small" />
            )}
          </View>
          <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
            {session.currentContent.title}
          </Text>
          {session.currentContent.imageUrl ? (
            <Image
              source={{ uri: session.currentContent.imageUrl }}
              resizeMode="cover"
              style={[styles.readImage, immersive && styles.immersiveReadImage]}
            />
          ) : null}
          {session.currentContent.source ? (
            session.currentContent.sourceUrl ? (
              <Pressable onPress={() => openExternalUrl(session.currentContent.sourceUrl)}>
                <Text style={[styles.hintText, styles.sourceLinkText]}>
                  {session.currentContent.source}
                  {session.currentContent.publishedAt
                    ? ` · ${new Date(session.currentContent.publishedAt).toLocaleDateString()}`
                    : ""}
                  {" · Open article"}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.hintText}>
                {session.currentContent.source}
                {session.currentContent.publishedAt
                  ? ` · ${new Date(session.currentContent.publishedAt).toLocaleDateString()}`
                  : ""}
              </Text>
            )
          ) : null}
          <Text style={styles.hintText}>{session.currentContent.lengthLabel}</Text>
          {session.currentContent.segments.map((segment) => (
            <Text key={segment} style={[styles.readingText, immersive && styles.immersiveReadingText]}>
              {segment}
            </Text>
          ))}
          {session.contentError ? <Text style={styles.errorText}>{session.contentError}</Text> : null}
        </View>
      );
    }

    if (session.currentMode === "teaser") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>Brain teaser</Text>
          <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
            {session.currentContent.title}
          </Text>
          <Text style={[styles.promptText, immersive && styles.immersivePromptText]}>
            {session.currentContent.prompt}
          </Text>
          <PillButton active={false} disabled={false} label="Reveal answer" onPress={revealAnswer} />
          {session.answerRevealed && (
            <View style={styles.answerBox}>
              <Text style={styles.answerText}>{session.currentContent.answer}</Text>
            </View>
          )}
        </View>
      );
    }

    if (session.currentMode === "study") {
      return (
        <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
          <Text style={styles.microLabel}>Study</Text>
          <View style={styles.contentMetaRow}>
            <Text style={styles.metaBadge}>
              {studyPlan.done
                ? "Complete"
                : `Part ${studyPlan.currentChunkIndex + 1}${studyPlan.estimatedTotalChunks ? ` of \u02dc${studyPlan.estimatedTotalChunks}` : ""}`}
            </Text>
            {session.contentSource === "live-loading" && (
              <ActivityIndicator color="#2f5d49" size="small" />
            )}
          </View>
          {session.currentContent?.title && session.contentSource !== "live-loading" ? (
            <>
              <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
                {session.currentContent.title}
              </Text>
              {session.currentContent.imageUrl ? (
                <Image
                  source={{ uri: session.currentContent.imageUrl }}
                  resizeMode="cover"
                  style={[styles.readImage, immersive && styles.immersiveReadImage]}
                />
              ) : null}
              {session.currentContent.body ? (
                <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
                  {session.currentContent.body}
                </Text>
              ) : null}
            </>
          ) : null}
          {!studyPlan.done && session.contentSource !== "live-loading" && session.currentContent?.body ? (
            <Pressable
              onPress={handleStudyNext}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
            >
              <Text style={styles.ghostButtonText}>Next \u2192</Text>
            </Pressable>
          ) : null}
          {studyPlan.done ? (
            <View style={styles.focusBox}>
              <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
                Study complete. Tap End Session in the setup panel to start fresh.
              </Text>
            </View>
          ) : null}
          {session.contentError ? (
            <Text style={styles.errorText}>{session.contentError}</Text>
          ) : null}
        </View>
      );
    }

    return (
      <View style={[styles.contentCard, immersive && styles.immersiveContentCard]}>
        <Text style={styles.microLabel}>Arcade drill</Text>
        <Text style={[styles.contentTitle, immersive && styles.immersiveContentTitle]}>
          {session.currentContent.title}
        </Text>
        <Text style={[styles.bodyText, immersive && styles.immersiveBodyText]}>
          {session.currentContent.body}
        </Text>
        <View style={styles.scoreRow}>
          <View style={styles.scoreChip}>
            <Text style={styles.scoreChipText}>Score: {game.score}</Text>
          </View>
          <View style={styles.scoreChip}>
            <Text style={styles.scoreChipText}>Move the paddle to redirect the ball</Text>
          </View>
        </View>
        <View
          onLayout={handleBoardLayout}
          onStartShouldSetResponder={() => true}
          onResponderGrant={(event) => updatePaddle(event.nativeEvent.locationX)}
          onResponderMove={(event) => updatePaddle(event.nativeEvent.locationX)}
          style={[styles.gameBoard, immersive && styles.immersiveGameBoard]}
        >
          {game.obstacles.map((obstacle, index) => (
            <View
              key={`obstacle-${index}`}
              style={[
                styles.obstacle,
                {
                  left: obstacle.x,
                  top: obstacle.y,
                  width: obstacle.width,
                  height: obstacle.height,
                },
              ]}
            />
          ))}
          <View
            style={[
              styles.targetDot,
              {
                left: game.target.x,
                top: game.target.y,
                width: game.target.size,
                height: game.target.size,
                borderRadius: game.target.size / 2,
              },
            ]}
          />
          <View
            style={[
              styles.ball,
              {
                left: game.ball.x,
                top: game.ball.y,
                width: game.ball.size,
                height: game.ball.size,
                borderRadius: game.ball.size / 2,
              },
            ]}
          />
          <View
            style={[
              styles.paddle,
              {
                left: game.paddleX,
                top: game.paddleY,
                width: game.paddleWidth,
                height: PADDLE_HEIGHT,
              },
            ]}
          />
        </View>
        <Text style={styles.hintText}>
          Drag anywhere on the game area to move the bar. Each collected dot jumps to a new spot.
        </Text>
      </View>
    );
  }

  function renderSetupScreen() {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.heroTextWrap}>
              <Text style={styles.kicker}>Gym Rest Timer Prototype</Text>
              <Text style={styles.heroTitle}>Rep Break</Text>
            </View>
            <View style={styles.heroBadges}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Timer first</Text>
              </View>
              <View style={styles.versionBadge}>
                <Text style={styles.versionBadgeText}>{APP_BUILD_LABEL}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.heroCopy}>
            Finish a set, get one short distraction, then get pulled back into the workout.
          </Text>
        </View>

        <View style={styles.card}>
          <Pressable
            onPress={() => setSetupCollapsed((c) => !c)}
            style={({ pressed }) => [styles.setupCollapseHeader, pressed && styles.pillButtonPressed]}
          >
            <View>
              <Text style={styles.kicker}>Setup</Text>
              <Text style={styles.sectionTitle}>Rest and content</Text>
            </View>
            <Text style={styles.collapseChevron}>{setupCollapsed ? "▶" : "▼"}</Text>
          </Pressable>
          {!setupCollapsed && (
          <>
          <Text style={styles.controlLabel}>Rest preset</Text>
          <View style={styles.rowWrap}>
            {REST_PRESETS.map((seconds) => (
              <PillButton
                key={seconds}
                active={seconds === session.selectedRest}
                disabled={false}
                label={`${seconds}s`}
                onPress={() => updateRest(seconds)}
              />
            ))}
          </View>
          <Text style={[styles.controlLabel, styles.groupSpacing]}>Micro-content</Text>
          <View style={styles.rowWrap}>
            {Object.entries(modeLabels).map(([mode, label]) => (
              <PillButton
                key={mode}
                active={mode === session.selectedMode}
                disabled={false}
                label={label}
                onPress={() => updateMode(mode)}
              />
            ))}
          </View>
          {session.selectedMode === "study" && (
            <View style={styles.studySetupPanel}>
              <Text style={styles.microLabel}>Study setup</Text>
              <Text style={styles.controlLabel}>Your goal (max 150 chars)</Text>
              <TextInput
                maxLength={150}
                value={studyIntent}
                onChangeText={setStudyIntent}
                placeholder="e.g. I adopted a cat. Teach me about cat care and behaviour."
                style={styles.textInput}
              />
              <Text style={styles.controlLabel}>Paste a URL (optional)</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={studySetup.url}
                onChangeText={(url) =>
                  setStudySetup((current) => ({
                    ...current,
                    url,
                    pdfBase64: null,
                    pdfFileName: null,
                    imageBase64: null,
                    imageType: null,
                    parseError: null,
                  }))
                }
                placeholder="https://..."
                style={styles.textInput}
              />
              <View style={styles.rowWrap}>
                <Pressable
                  onPress={pickPDF}
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
                >
                  <Text style={styles.ghostButtonText}>
                    {studySetup.pdfFileName ? `PDF: ${studySetup.pdfFileName}` : "Pick PDF"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={pickImage}
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
                >
                  <Text style={styles.ghostButtonText}>
                    {studySetup.imageBase64 ? "Image loaded \u2713" : "Pick Image"}
                  </Text>
                </Pressable>
              </View>
              {studySetup.parseError ? (
                <Text style={styles.errorText}>{studySetup.parseError}</Text>
              ) : null}
              {(studyPlan.chunks.length > 0 || studyPlan.done) && (
                <View style={styles.studySessionStatus}>
                  <Text style={styles.hintText}>
                    {studyPlan.done
                      ? "Study session complete."
                      : `Active session \u00b7 Part ${studyPlan.currentChunkIndex + 1}${studyPlan.estimatedTotalChunks ? ` of ~${studyPlan.estimatedTotalChunks}` : ""}`}
                  </Text>
                  <Pressable
                    onPress={clearStudySession}
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
                  >
                    <Text style={styles.ghostButtonText}>End Session</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
          <View style={styles.setupActionsRow}>
            <Pressable
              onPress={() => setShowRulesReview((current) => !current)}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
            >
              <Text style={styles.ghostButtonText}>
                {showRulesReview || !rulesDismissed ? "Hide rules" : "Review rules"}
              </Text>
            </Pressable>
            {!rulesDismissed && (
              <Pressable
                onPress={dismissRulesForever}
                style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
              >
                <Text style={styles.ghostButtonText}>Hide after this</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setShowAiSettings((current) => !current)}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
            >
              <Text style={styles.ghostButtonText}>
                {showAiSettings ? "Close fresh content" : "Fresh content setup"}
              </Text>
            </Pressable>
          </View>
          {(!rulesDismissed || showRulesReview) && (
            <View style={styles.principlesBox}>
              <View style={styles.principleItem}>
                <Text style={styles.microLabel}>Rule</Text>
                <Text style={styles.bodyText}>Only one item per rest period.</Text>
              </View>
              <View style={styles.principleItem}>
                <Text style={styles.microLabel}>Focus window</Text>
                <Text style={styles.bodyText}>
                  Final {session.focusWindow} seconds are reserved for reset.
                </Text>
              </View>
              <View style={styles.principleItem}>
                <Text style={styles.microLabel}>End behavior</Text>
                <Text style={styles.bodyText}>
                  Haptics, vibration, and a forced return to workout mode.
                </Text>
              </View>
              <Text style={styles.hintText}>
                Keep this tucked away once you know the flow. You can always bring it back with
                Review rules.
              </Text>
            </View>
          )}
          {showAiSettings && (
            <View style={styles.settingsPanel}>
              <Text style={styles.microLabel}>Fresh reads and facts</Text>
              <Text style={styles.bodyText}>
                Plug in an OpenAI-compatible chat completions endpoint if you want reads and facts
                to be generated live instead of always coming from the local library.
              </Text>
              <Text style={styles.hintText}>
                Stored locally on this {Platform.OS === "web" ? "browser" : "device"}. Game and
                brain teaser modes stay local.
              </Text>
              <Text style={styles.hintText}>
                The default prompts now target recent tech, business, science, and culture reads,
                plus broader fun facts across fitness, health, sports, and everyday science.
                Length still adapts to the rest time you choose.
              </Text>
              <Text style={styles.hintText}>{liveStatus}</Text>
              <View style={styles.settingsToggleRow}>
                <Text style={styles.controlLabel}>Live content</Text>
                <PillButton
                  active={aiDraft.enabled}
                  disabled={false}
                  label={aiDraft.enabled ? "Enabled" : "Disabled"}
                  onPress={() =>
                    setAiDraft((current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }))
                  }
                />
              </View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setAiDraft((current) => ({ ...current, endpoint: value }))}
                placeholder="https://api.openai.com/v1/chat/completions"
                style={styles.textInput}
                value={aiDraft.endpoint}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setAiDraft((current) => ({ ...current, model: value }))}
                placeholder="gpt-4.1-mini"
                style={styles.textInput}
                value={aiDraft.model}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setAiDraft((current) => ({ ...current, apiKey: value }))}
                placeholder="API key"
                secureTextEntry
                style={styles.textInput}
                value={aiDraft.apiKey}
              />
              <Text style={styles.controlLabel}>Custom read instruction</Text>
              <TextInput
                multiline
                onChangeText={(value) => setAiDraft((current) => ({ ...current, readPrompt: value }))}
                placeholder="Prompt for fresh AI reads"
                style={[styles.textInput, styles.multilineInput]}
                value={aiDraft.readPrompt}
              />
              <Text style={styles.controlLabel}>Custom fact instruction</Text>
              <TextInput
                multiline
                onChangeText={(value) => setAiDraft((current) => ({ ...current, factPrompt: value }))}
                placeholder="Prompt for workout facts"
                style={[styles.textInput, styles.multilineInput]}
                value={aiDraft.factPrompt}
              />
              <View style={styles.setupActionsRow}>
                <Pressable
                  onPress={saveAiConfiguration}
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
                >
                  <Text style={styles.ghostButtonText}>Save settings</Text>
                </Pressable>
                <Pressable
                  onPress={clearAiConfiguration}
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.pillButtonPressed]}
                >
                  <Text style={styles.ghostButtonText}>Clear saved values</Text>
                </Pressable>
              </View>
              {settingsHydrated && aiSettings.apiKey ? (
                <Text style={styles.hintText}>
                  Saved model: {aiSettings.model || "not set"}. Reads and facts will start with a
                  local fallback and then refresh live during the rest window.
                </Text>
              ) : null}
            </View>
          )}
          </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>Session</Text>
          <Text style={styles.sectionTitle}>Between sets</Text>
          <Text style={styles.controlLabel}>Current group name</Text>
          <TextInput
            onChangeText={updateGroupName}
            placeholder="Group name"
            style={styles.textInput}
            value={session.groupName}
          />
          <Text style={styles.hintText}>
            Starting a new group saves each finished rest, the total rest time, and the average.
          </Text>
          <View style={styles.statusRow}>
            <View style={styles.phasePill}>
              <Text style={styles.phasePillText}>{phasePill}</Text>
            </View>
            <View style={styles.statusActions}>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatText}>Rests in group: {currentGroupDurations.length}</Text>
              </View>
              <Pressable
                disabled={false}
                onPress={resetSetCount}
                style={({ pressed }) => [
                  styles.resetButton,
                  pressed && styles.pillButtonPressed,
                ]}
              >
                <Text style={styles.resetButtonText}>Start new group</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.timerCircle, focusPhase && styles.timerCircleWarning]}>
            <Text style={styles.timerNumber}>{session.remaining}</Text>
            <Text style={styles.timerLabel}>{session.openEndedRest ? "elapsed" : "seconds"}</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(0, Math.min(100, progressRatio * 100))}%` },
                ]}
              />
            </View>
          </View>
          <Text style={styles.sessionHeadline}>{headline}</Text>
          <Text style={styles.sessionCopy}>{subcopy}</Text>
          <Pressable
            disabled={false}
            onPress={onPrimaryAction}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </Pressable>
          <View style={styles.metricGrid}>
            <MetricCard label="Selected rest" value={`${session.selectedRest}s`} />
            <MetricCard label="Mode" value={modeLabels[session.selectedMode]} />
            <MetricCard label="Current phase" value={phaseDetail} />
            <MetricCard
              label="This set rest"
              value={currentRestDisplaySeconds != null ? formatDuration(currentRestDisplaySeconds) : "Not started"}
            />
            <MetricCard
              label="Group average"
              value={currentGroupDurations.length > 0 ? formatDuration(currentGroupAverage) : "No rests yet"}
            />
          </View>
          {latestSavedReport ? (
            <View style={styles.historyPanel}>
              <Text style={styles.microLabel}>Latest saved group</Text>
              <Text style={styles.reportTitle}>{latestSavedReport.name}</Text>
              <Text style={styles.reportStats}>
                {latestSavedReport.setCount} rests · avg {formatDuration(latestSavedReport.averageRestSeconds)} · total {formatDuration(latestSavedReport.totalRestSeconds)}
              </Text>
              <Text style={styles.hintText}>
                Rests: {latestSavedReport.restDurations.map((value) => formatDuration(value)).join(" • ")}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>History</Text>
          <View style={styles.historyTitleRow}>
            <Text style={styles.sectionTitle}>Saved groups</Text>
            <Pressable
              disabled={restReports.length === 0}
              onPress={clearRestHistory}
              style={({ pressed }) => [
                styles.ghostButton,
                restReports.length === 0 && styles.disabledButton,
                pressed && restReports.length > 0 && styles.pillButtonPressed,
              ]}
            >
              <Text style={styles.ghostButtonText}>Clear history</Text>
            </Pressable>
          </View>
          {restReports.length === 0 ? (
            <Text style={styles.bodyText}>
              No saved groups yet. Finish a few rests, then tap Start new group to preserve the report.
            </Text>
          ) : (
            <View style={styles.historyList}>
              {restReports.slice(0, 6).map((report) => (
                <View key={report.id} style={styles.reportCard}>
                  <View style={styles.reportHeader}>
                    <Text style={styles.reportTitle}>{report.name}</Text>
                    <Text style={styles.reportDate}>
                      {new Date(report.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.reportStats}>
                    {report.setCount} rests · avg {formatDuration(report.averageRestSeconds)} · total {formatDuration(report.totalRestSeconds)}
                  </Text>
                  <Text style={styles.hintText}>
                    Rests: {report.restDurations.map((value) => formatDuration(value)).join(" • ")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.contentHeader}>
            <View>
              <Text style={styles.kicker}>Micro Entertainment</Text>
              <Text style={styles.sectionTitle}>One item at a time</Text>
            </View>
            <View style={styles.contentTag}>
              <Text style={styles.contentTagText}>
                {session.phase === "idle"
                  ? "Preview"
                  : session.phase === "alert"
                    ? "Locked"
                    : focusPhase
                      ? "Focus up"
                      : modeLabels[session.currentMode]}
              </Text>
            </View>
          </View>
          {renderContentPanel(false)}
        </View>
      </ScrollView>
    );
  }

  function renderImmersiveScreen() {
    return (
      <ScrollView contentContainerStyle={[styles.screen, styles.immersiveScreen]}>
        <View style={styles.immersiveStatusRow}>
          <View style={styles.immersiveStatusLeft}>
            <View style={styles.phasePill}>
              <Text style={styles.phasePillText}>{phasePill}</Text>
            </View>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>{APP_BUILD_LABEL}</Text>
            </View>
          </View>
          <Text style={styles.immersiveModeLabel}>{modeLabels[session.currentMode]}</Text>
        </View>
        <View style={[styles.timerCircle, styles.immersiveTimerCircle, focusPhase && styles.timerCircleWarning]}>
          <Text style={styles.timerNumber}>{session.remaining}</Text>
          <Text style={styles.timerLabel}>{session.openEndedRest ? "elapsed" : "seconds"}</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(0, Math.min(100, progressRatio * 100))}%` },
              ]}
            />
          </View>
        </View>
        <Text style={styles.immersiveHeadline}>{headline}</Text>
        <Text style={styles.immersiveCopy}>{subcopy}</Text>
        <View style={styles.immersiveRestSummary}>
          <Text style={styles.immersiveRestSummaryText}>
            {session.openEndedRest
              ? `Resting freely: ${formatDuration(session.remaining || 0)} elapsed`
              : `Rested so far: ${formatDuration(currentRestDisplaySeconds || 0)} / ${formatDuration(session.totalSeconds)} planned`}
          </Text>
        </View>
        <View style={styles.immersiveActionsRow}>
          {["read", "fact"].includes(session.currentMode) && !focusPhase ? (
            <Pressable
              onPress={requestMoreContent}
              style={({ pressed }) => [styles.ghostButton, styles.immersiveGhostButton, pressed && styles.pillButtonPressed]}
            >
              <Text style={styles.ghostButtonText}>
                {session.currentMode === "fact" ? "Know more" : "Read more"}
              </Text>
            </Pressable>
          ) : null}
          {!session.openEndedRest && (
            <Pressable
              onPress={addMoreRest}
              style={({ pressed }) => [styles.ghostButton, styles.immersiveGhostButton, pressed && styles.pillButtonPressed]}
            >
              <Text style={styles.ghostButtonText}>I need more rest</Text>
            </Pressable>
          )}
          <Pressable
            onPress={endRestNow}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>End rest now</Text>
          </Pressable>
        </View>
        {renderContentPanel(true)}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" />
      {immersiveRest ? renderImmersiveScreen() : renderSetupScreen()}
      <Modal animationType="fade" transparent visible={session.phase === "alert"}>
        <View style={styles.overlay}>
          <View style={styles.alertCard}>
            <Text style={styles.kicker}>Rest complete</Text>
            <Text style={styles.sectionTitle}>Back to the workout</Text>
            <Text style={styles.bodyText}>Start set {session.completedSets + 1} now.</Text>
            <Pressable
              onPress={dismissAlert}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            >
              <Text style={styles.primaryButtonText}>Dismiss and lift</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#eef1e8",
  },
  screen: {
    padding: 18,
    paddingBottom: 40,
    gap: 18,
  },
  immersiveScreen: {
    paddingTop: 28,
    justifyContent: "center",
  },
  heroCard: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.84)",
    shadowColor: "#1c281e",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  heroTextWrap: {
    flexShrink: 1,
  },
  heroBadges: {
    alignItems: "flex-end",
    gap: 8,
  },
  heroBadge: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(47,93,73,0.1)",
  },
  heroBadgeText: {
    color: "#2f5d49",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  versionBadge: {
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "rgba(23,32,27,0.08)",
  },
  versionBadgeText: {
    color: "#17201b",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  card: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: "rgba(255,255,255,0.84)",
    shadowColor: "#1c281e",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
    gap: 14,
  },
  kicker: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 11,
    color: "#5c6a60",
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#17201b",
    letterSpacing: -1,
  },
  heroCopy: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    color: "#5c6a60",
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#17201b",
    letterSpacing: -1,
  },
  controlLabel: {
    marginTop: 8,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#5c6a60",
  },
  groupSpacing: {
    marginTop: 16,
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  setupActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  pillButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f3f5ef",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillButtonActive: {
    backgroundColor: "#2f5d49",
  },
  pillButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  pillButtonText: {
    color: "#17201b",
    fontWeight: "600",
  },
  pillButtonTextActive: {
    color: "#ffffff",
  },
  disabledButton: {
    opacity: 0.55,
  },
  ghostButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(23,32,27,0.12)",
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ghostButtonText: {
    color: "#17201b",
    fontWeight: "600",
  },
  principlesBox: {
    marginTop: 6,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.76)",
    gap: 14,
  },
  principleItem: {
    gap: 5,
  },
  settingsPanel: {
    marginTop: 6,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.76)",
    gap: 12,
  },
  settingsToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  textInput: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(23,32,27,0.12)",
    backgroundColor: "rgba(255,255,255,0.96)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#17201b",
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  microLabel: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 11,
    color: "#5c6a60",
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 24,
    color: "#5c6a60",
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  statusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  phasePill: {
    borderRadius: 999,
    backgroundColor: "#dce9e2",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  phasePillText: {
    color: "#2f5d49",
    fontWeight: "700",
  },
  immersiveStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  immersiveStatusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  immersiveModeLabel: {
    color: "#5c6a60",
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  miniStat: {
    borderRadius: 999,
    backgroundColor: "rgba(47,93,73,0.08)",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  miniStatText: {
    color: "#5c6a60",
    fontWeight: "600",
  },
  resetButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(23,32,27,0.12)",
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  resetButtonText: {
    color: "#17201b",
    fontWeight: "600",
  },
  timerCircle: {
    alignSelf: "center",
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 16,
    borderColor: "#2f5d49",
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  timerCircleWarning: {
    borderColor: "#b26239",
  },
  immersiveTimerCircle: {
    width: 272,
    height: 272,
    borderRadius: 136,
  },
  timerNumber: {
    fontSize: 64,
    fontWeight: "800",
    color: "#17201b",
    lineHeight: 68,
  },
  timerLabel: {
    color: "#5c6a60",
    fontSize: 14,
  },
  progressTrack: {
    marginTop: 18,
    width: "100%",
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(47,93,73,0.12)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#2f5d49",
  },
  sessionHeadline: {
    textAlign: "center",
    fontSize: 28,
    fontWeight: "800",
    color: "#17201b",
    letterSpacing: -1,
  },
  sessionCopy: {
    textAlign: "center",
    color: "#5c6a60",
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 340,
    alignSelf: "center",
  },
  immersiveHeadline: {
    textAlign: "center",
    fontSize: 34,
    fontWeight: "800",
    color: "#17201b",
    letterSpacing: -1.1,
  },
  immersiveCopy: {
    textAlign: "center",
    color: "#5c6a60",
    fontSize: 17,
    lineHeight: 28,
    maxWidth: 420,
    alignSelf: "center",
  },
  immersiveActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  immersiveRestSummary: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "rgba(47,93,73,0.08)",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  immersiveRestSummaryText: {
    color: "#17201b",
    fontSize: 15,
    fontWeight: "600",
  },
  immersiveGhostButton: {
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  primaryButton: {
    marginTop: 6,
    backgroundColor: "#17201b",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    alignSelf: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(23,32,27,0.14)",
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingVertical: 14,
    paddingHorizontal: 18,
    minWidth: 180,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#17201b",
    fontSize: 15,
    fontWeight: "700",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: 140,
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  metricLabel: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 11,
    color: "#5c6a60",
  },
  metricValue: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: "#17201b",
  },
  historyPanel: {
    marginTop: 4,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.76)",
    gap: 8,
  },
  historyTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  historyList: {
    gap: 12,
  },
  reportCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.76)",
    gap: 8,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  reportTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#17201b",
  },
  reportDate: {
    color: "#5c6a60",
    fontSize: 13,
  },
  reportStats: {
    color: "#17201b",
    fontSize: 14,
    fontWeight: "600",
  },
  contentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  contentTag: {
    borderRadius: 999,
    backgroundColor: "#dce9e2",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  contentTagText: {
    color: "#2f5d49",
    fontWeight: "700",
  },
  contentCard: {
    borderRadius: 24,
    padding: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    gap: 12,
    minHeight: 220,
    justifyContent: "center",
  },
  immersiveContentCard: {
    minHeight: 360,
    padding: 28,
    gap: 16,
  },
  contentTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#17201b",
    letterSpacing: -0.8,
  },
  immersiveContentTitle: {
    fontSize: 34,
    letterSpacing: -1.1,
  },
  contentMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  readImage: {
    width: "100%",
    height: 160,
    borderRadius: 18,
    backgroundColor: "rgba(47,93,73,0.08)",
  },
  immersiveReadImage: {
    height: 220,
  },
  metaBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(47,93,73,0.08)",
    color: "#2f5d49",
    fontSize: 13,
    fontWeight: "700",
  },
  readingText: {
    fontSize: 17,
    lineHeight: 27,
    color: "#455148",
  },
  immersiveReadingText: {
    fontSize: 20,
    lineHeight: 32,
  },
  hintText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#5c6a60",
  },
  sourceLinkText: {
    textDecorationLine: "underline",
  },
  immersiveBodyText: {
    fontSize: 18,
    lineHeight: 30,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#b26239",
  },
  promptText: {
    fontSize: 20,
    lineHeight: 29,
    color: "#17201b",
  },
  immersivePromptText: {
    fontSize: 28,
    lineHeight: 40,
  },
  answerBox: {
    marginTop: 6,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "rgba(47,93,73,0.08)",
  },
  answerText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#17201b",
  },
  quizOptionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quizOptionChip: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(47,93,73,0.08)",
  },
  quizOptionChipSelected: {
    borderWidth: 1,
    borderColor: "rgba(23,32,27,0.18)",
  },
  quizOptionChipCorrect: {
    backgroundColor: "rgba(47,93,73,0.18)",
  },
  quizOptionChipWrong: {
    backgroundColor: "rgba(178,98,57,0.16)",
  },
  quizOptionText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#17201b",
    fontWeight: "600",
  },
  scoreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  scoreChip: {
    borderRadius: 999,
    backgroundColor: "rgba(47,93,73,0.08)",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  scoreChipText: {
    color: "#17201b",
    fontWeight: "600",
  },
  focusBox: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: "rgba(178,98,57,0.12)",
  },
  gameBoard: {
    marginTop: 4,
    height: GAME_BOARD_HEIGHT,
    borderRadius: 22,
    backgroundColor: "#edf4ea",
    borderWidth: 1,
    borderColor: "rgba(47,93,73,0.14)",
    overflow: "hidden",
    position: "relative",
  },
  immersiveGameBoard: {
    height: 320,
  },
  obstacle: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#90b59d",
  },
  targetDot: {
    position: "absolute",
    backgroundColor: "#f29b4a",
  },
  ball: {
    position: "absolute",
    backgroundColor: "#17201b",
  },
  paddle: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#2f5d49",
  },
  setupCollapseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  collapseChevron: {
    fontSize: 18,
    color: "#5c6a60",
    fontWeight: "600",
    paddingLeft: 8,
  },
  studySetupPanel: {
    marginTop: 6,
    gap: 10,
  },
  studySessionStatus: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(14,21,17,0.46)",
    justifyContent: "center",
    padding: 20,
  },
  alertCard: {
    borderRadius: 28,
    padding: 24,
    backgroundColor: "rgba(255,255,255,0.96)",
    gap: 12,
  },
});

export default App;
