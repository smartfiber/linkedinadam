export const ANALYTICS_TIME_ZONE = "America/Chicago";

export type PostMetrics = {
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  clicks: number;
  qualified_conversations: number;
  leads: number;
};

export type MeasuredPost = PostMetrics & {
  id: number;
  employee_name: string;
  post_format: string | null;
  topic: string | null;
  image_key: string | null;
};

export type MetricSummary = PostMetrics & {
  measuredPosts: number;
  engagements: number;
  engagementRate: number | null;
  clickRate: number | null;
  conversationRate: number | null;
  leadRate: number | null;
};

export function safeRate(
  numerator: number,
  denominator: number,
) {
  return denominator > 0
    ? (numerator / denominator) * 100
    : null;
}

export function summarizePosts(
  posts: MeasuredPost[],
): MetricSummary {
  const totals = posts.reduce<PostMetrics>(
    (summary, post) => ({
      impressions: summary.impressions + post.impressions,
      reactions: summary.reactions + post.reactions,
      comments: summary.comments + post.comments,
      reposts: summary.reposts + post.reposts,
      clicks: summary.clicks + post.clicks,
      qualified_conversations:
        summary.qualified_conversations
        + post.qualified_conversations,
      leads: summary.leads + post.leads,
    }),
    {
      impressions: 0,
      reactions: 0,
      comments: 0,
      reposts: 0,
      clicks: 0,
      qualified_conversations: 0,
      leads: 0,
    },
  );
  const engagements =
    totals.reactions + totals.comments + totals.reposts;

  return {
    ...totals,
    measuredPosts: posts.length,
    engagements,
    engagementRate: safeRate(engagements, totals.impressions),
    clickRate: safeRate(totals.clicks, totals.impressions),
    conversationRate: safeRate(
      totals.qualified_conversations,
      totals.impressions,
    ),
    leadRate: safeRate(totals.leads, totals.impressions),
  };
}

export function groupPostPerformance(
  posts: MeasuredPost[],
  getKey: (post: MeasuredPost) => string,
) {
  const groups = new Map<string, MeasuredPost[]>();

  for (const post of posts) {
    const key = getKey(post);
    const group = groups.get(key) ?? [];

    group.push(post);
    groups.set(key, group);
  }

  return Array.from(groups, ([label, group]) => ({
    label,
    ...summarizePosts(group),
  })).sort(
    (left, right) =>
      (right.engagementRate ?? -1)
      - (left.engagementRate ?? -1),
  );
}

export function buildContentInsights(posts: MeasuredPost[]) {
  const insights: string[] = [];
  const baseline = summarizePosts(posts);
  const formatGroups = groupPostPerformance(
    posts,
    (post) =>
      post.post_format === "short_post"
        ? "Short posts"
        : "Original posts",
  ).filter((group) => group.measuredPosts >= 3);
  const topicGroups = groupPostPerformance(
    posts.filter((post) => post.topic),
    (post) => post.topic as string,
  ).filter((group) => group.measuredPosts >= 3);
  const imageGroups = groupPostPerformance(
    posts,
    (post) => (post.image_key ? "With image" : "Without image"),
  ).filter((group) => group.measuredPosts >= 3);

  if (
    formatGroups[0]?.engagementRate != null &&
    baseline.engagementRate != null
  ) {
    insights.push(
      `${formatGroups[0].label} lead engagement rate at ${formatGroups[0].engagementRate.toFixed(2)}% across ${formatGroups[0].measuredPosts} measured posts, compared with the ${baseline.engagementRate.toFixed(2)}% weighted baseline.`,
    );
  }

  if (
    topicGroups[0]?.engagementRate != null &&
    baseline.engagementRate != null
  ) {
    insights.push(
      `“${topicGroups[0].label}” is the strongest sufficiently sampled topic at ${topicGroups[0].engagementRate.toFixed(2)}% engagement across ${topicGroups[0].measuredPosts} posts. This is an association, not proof that the topic caused performance.`,
    );
  }

  if (
    imageGroups.length === 2 &&
    imageGroups[0].engagementRate != null &&
    imageGroups[1].engagementRate != null
  ) {
    insights.push(
      `${imageGroups[0].label} currently leads ${imageGroups[1].label} (${imageGroups[0].engagementRate.toFixed(2)}% vs. ${imageGroups[1].engagementRate.toFixed(2)}% engagement), with at least three posts in each group.`,
    );
  }

  if (!insights.length) {
    insights.push(
      "More data is needed. At least three measured posts per segment are required before DEVOS presents a comparative content insight.",
    );
  }

  return insights;
}
