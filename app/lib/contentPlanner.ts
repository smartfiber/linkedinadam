export const PLANNER_TIME_ZONE = "America/Chicago";
export const PLANNER_MODEL = "gpt-5-mini";

export type PlannedPostFormat =
  | "original_post"
  | "short_post";

export type GeneratedPlanItem = {
  post_format: PlannedPostFormat;
  topic: string;
  angle: string;
  rationale: string;
  suggested_scheduled_for: string;
};

export function getMonday(value?: string | null) {
  const valid = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 10);
  const date = new Date(`${valid}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Choose a valid planning week.");
  }

  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));

  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function topicTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

export function topicSimilarity(left: string, right: string) {
  const leftTokens = topicTokens(left);
  const rightTokens = topicTokens(right);

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return intersection / union;
}

export function findDuplicateTopic(
  topic: string,
  otherTopics: string[],
  threshold = 0.65,
) {
  return otherTopics.find(
    (candidate) => topicSimilarity(topic, candidate) >= threshold,
  ) ?? null;
}

export function validateGeneratedPlan(
  items: GeneratedPlanItem[],
  input: {
    weekStart: string;
    originalPostTarget: number;
    shortPostTarget: number;
    recentTopics: string[];
    occupiedTimes: string[];
  },
) {
  const expectedCount =
    input.originalPostTarget + input.shortPostTarget;
  const weekEnd = addDays(input.weekStart, 7);

  if (items.length !== expectedCount) {
    throw new Error(
      `The generated plan contained ${items.length} items; ${expectedCount} were required.`,
    );
  }

  const originalCount = items.filter(
    (item) => item.post_format === "original_post",
  ).length;
  const shortCount = items.filter(
    (item) => item.post_format === "short_post",
  ).length;

  if (
    originalCount !== input.originalPostTarget ||
    shortCount !== input.shortPostTarget
  ) {
    throw new Error("The generated plan did not match the playbook format targets.");
  }

  const acceptedTopics = [...input.recentTopics];
  const acceptedTimes = [...input.occupiedTimes];

  for (const item of items) {
    item.topic = item.topic.trim();
    item.angle = item.angle.trim();
    item.rationale = item.rationale.trim();

    if (!item.topic || !item.angle || !item.rationale) {
      throw new Error("The generated plan included an incomplete item.");
    }

    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(
        item.suggested_scheduled_for,
      ) ||
      item.suggested_scheduled_for < `${input.weekStart}T00:00` ||
      item.suggested_scheduled_for >= `${weekEnd}T00:00`
    ) {
      throw new Error("The generated plan included a time outside the selected week.");
    }

    const duplicate = findDuplicateTopic(item.topic, acceptedTopics);

    if (duplicate) {
      throw new Error(
        `The generated topic “${item.topic}” is too similar to “${duplicate}”.`,
      );
    }

    const candidateTime = new Date(
      `${item.suggested_scheduled_for}:00Z`,
    ).getTime();
    const hasConflict = acceptedTimes.some((value) => {
      const existingTime = new Date(`${value}:00Z`).getTime();
      return Math.abs(candidateTime - existingTime) < 30 * 60 * 1000;
    });

    if (hasConflict) {
      throw new Error("The generated plan included a scheduling conflict.");
    }

    acceptedTopics.push(item.topic);
    acceptedTimes.push(item.suggested_scheduled_for);
  }

  return items;
}
