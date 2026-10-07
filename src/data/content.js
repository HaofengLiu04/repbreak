export const modeLabels = {
  random: "Random mix",
  fact: "Fun fact",
  read: "Short read",
  teaser: "Brain teaser",
  game: "Tap game",
  study: "Study",
};

export const availableModes = ["fact", "read", "teaser", "game"];

const library = {
  fact: [
    {
      title: "Grip fact",
      body: "Your forearm muscles drive most of your grip endurance, which is why simple carries and hangs improve more lifts than people expect.",
      quizType: "multiple-choice",
      question: "Which muscles do most of the work for grip endurance?",
      options: ["Chest muscles", "Forearm muscles", "Calf muscles"],
      answer: "Forearm muscles",
    },
    {
      title: "Recovery fact",
      body: "Phosphocreatine replenishes quickly in the first minute after a hard effort, which is one reason short strength rests still matter so much.",
      quizType: "true-false",
      question: "True or false: the first minute after a hard effort does almost nothing for rapid energy recovery.",
      options: ["True", "False"],
      answer: "False",
    },
    {
      title: "Focus fact",
      body: "Short external cues like 'drive the floor away' are easier to act on under fatigue than long technique checklists.",
      quizType: "multiple-choice",
      question: "Under fatigue, which cue style is usually easier to act on?",
      options: ["A short external cue", "A long checklist", "No cue at all"],
      answer: "A short external cue",
    },
  ],
  read: [
    {
      title: "Momentum note",
      segments: [
        "A good gym ritual is boring on purpose: same shoes, same warm-up, same first cue before the set.",
        "Repetition lowers friction, and lower friction is often what makes consistency feel easy instead of forced.",
        "When the timer removes decision fatigue, effort can stay aimed at the set instead of the phone.",
        "That is the real job of a rest tool: protect momentum without stealing attention.",
      ],
    },
    {
      title: "Micro article",
      segments: [
        "Most people think motivation starts a workout, but the smaller truth is that momentum does.",
        "Once the first set is done, the next useful job is simply protecting the rhythm so the session keeps moving.",
        "Short, closed-ended content can fill dead time without opening a rabbit hole.",
        "The best version feels like a breath between sets, not a second app competing for your focus.",
      ],
    },
    {
      title: "Training note",
      segments: [
        "Rest timing changes the feel of training more than most accessories do.",
        "Short rests make effort feel athletic and dense; longer rests make heavy sets feel deliberate and sharp.",
        "That means the reading length should adapt to the timer rather than forcing the same card every time.",
        "The best timer is the one you will actually obey, especially when fatigue starts negotiating with you.",
      ],
    },
  ],
  teaser: [
    {
      title: "Brain teaser",
      prompt: "What has keys but cannot open locks?",
      answer: "A piano.",
    },
    {
      title: "Brain teaser",
      prompt: "What gets wetter the more it dries?",
      answer: "A towel.",
    },
    {
      title: "Brain teaser",
      prompt: "What can travel around the world while staying in one corner?",
      answer: "A stamp.",
    },
  ],
};

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
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

function buildReadContent(totalSeconds, focusWindow) {
  const article = sample(library.read);
  const segmentCount = getReadSegmentCount(totalSeconds, focusWindow);

  return {
    title: article.title,
    segments: article.segments.slice(0, segmentCount),
    lengthLabel: `${segmentCount} ${segmentCount === 1 ? "chunk" : "chunks"} for a ${totalSeconds}s rest`,
  };
}

function buildFactContent() {
  const fact = sample(library.fact);

  return {
    title: fact.title,
    body: fact.body,
    quizType: fact.quizType,
    question: fact.question,
    options: fact.options,
    answer: fact.answer,
  };
}

export function computeFocusWindow(totalSeconds) {
  return Math.min(10, Math.max(6, Math.round(totalSeconds * 0.2)));
}

export function resolveMode(selectedMode) {
  if (selectedMode !== "random") {
    return selectedMode;
  }

  return sample(availableModes);
}

export function buildContent(mode, totalSeconds, focusWindow) {
  if (mode === "game") {
    return {
      title: "Dot Drift",
      body: "Slide the paddle to keep the ball alive, bounce through the field, and collect the moving dot before the rest window closes.",
    };
  }

  if (mode === "study") {
    return { title: "Loading\u2026", body: "" };
  }

  if (mode === "read") {
    return buildReadContent(totalSeconds, focusWindow);
  }

  if (mode === "fact") {
    return buildFactContent();
  }

  return sample(library[mode]);
}