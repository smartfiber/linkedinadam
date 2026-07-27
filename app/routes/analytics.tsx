import {
  Form,
  Link,
  redirect,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/analytics";
import {
  ANALYTICS_TIME_ZONE,
  buildContentInsights,
  groupPostPerformance,
  summarizePosts,
  type MeasuredPost,
} from "../lib/postAnalytics";
import {
  parseCapturedAt,
  parseMetricCount,
} from "../lib/postAnalytics.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type PublishedPost = MeasuredPost & {
  title: string | null;
  published_at: string;
  linkedin_post_url: string | null;
  captured_at: string | null;
  recorded_by: string | null;
};

type MetricSnapshot = {
  id: number;
  captured_at: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  clicks: number;
  qualified_conversations: number;
  leads: number;
  source: string;
  recorded_by: string;
  notes: string | null;
};

const metricFields = [
  ["impressions", "Impressions"],
  ["reactions", "Reactions"],
  ["comments", "Comments"],
  ["reposts", "Reposts"],
  ["clicks", "Clicks"],
  ["qualified_conversations", "Qualified conversations"],
  ["leads", "Leads"],
] as const;

function currentChicagoDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function cutoffForRange(range: string) {
  const days = range === "30" ? 30 : range === "90" ? 90 : null;

  if (!days) {
    return null;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  return cutoff.toISOString().slice(0, 19).replace("T", " ");
}

function formatPercent(value: number | null) {
  return value == null ? "N/A" : `${value.toFixed(2)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const range = ["30", "90", "all"].includes(
    url.searchParams.get("range") ?? "",
  )
    ? String(url.searchParams.get("range"))
    : "90";
  const cutoff = cutoffForRange(range);
  const selectedPostId = Number(url.searchParams.get("post"));

  const postsQuery = await env.linkedinadam_db
    .prepare(`
      WITH ranked_snapshots AS (
        SELECT
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY s.content_draft_id
            ORDER BY s.captured_at DESC, s.id DESC
          ) AS snapshot_rank
        FROM post_metric_snapshots s
      )
      SELECT
        c.id,
        e.name AS employee_name,
        c.title,
        c.topic,
        c.post_format,
        c.image_key,
        c.published_at,
        c.linkedin_post_url,
        s.captured_at,
        s.recorded_by,
        COALESCE(s.impressions, 0) AS impressions,
        COALESCE(s.reactions, 0) AS reactions,
        COALESCE(s.comments, 0) AS comments,
        COALESCE(s.reposts, 0) AS reposts,
        COALESCE(s.clicks, 0) AS clicks,
        COALESCE(s.qualified_conversations, 0)
          AS qualified_conversations,
        COALESCE(s.leads, 0) AS leads
      FROM content_drafts c
      JOIN employees e
        ON e.id = c.employee_id
      LEFT JOIN ranked_snapshots s
        ON s.content_draft_id = c.id
        AND s.snapshot_rank = 1
      WHERE c.status = 'published'
        AND (? IS NULL OR c.published_at >= ?)
      ORDER BY c.published_at DESC, c.id DESC
      LIMIT 500
    `)
    .bind(cutoff, cutoff)
    .all<PublishedPost>();

  const posts = postsQuery.results ?? [];
  const validSelectedPostId =
    Number.isInteger(selectedPostId) &&
    posts.some((post) => post.id === selectedPostId)
      ? selectedPostId
      : posts[0]?.id ?? null;
  const historyQuery = validSelectedPostId
    ? await env.linkedinadam_db
        .prepare(`
          SELECT
            id,
            captured_at,
            impressions,
            reactions,
            comments,
            reposts,
            clicks,
            qualified_conversations,
            leads,
            source,
            recorded_by,
            notes
          FROM post_metric_snapshots
          WHERE content_draft_id = ?
          ORDER BY captured_at DESC, id DESC
          LIMIT 100
        `)
        .bind(validSelectedPostId)
        .all<MetricSnapshot>()
    : null;

  return {
    posts,
    snapshotHistory: historyQuery?.results ?? [],
    selectedPostId: validSelectedPostId,
    range,
    currentLocalDateTime: currentChicagoDateTime(),
  };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const postId = Number(formData.get("content_draft_id"));
  const recordedBy = String(
    formData.get("recorded_by") ?? "",
  ).trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!Number.isInteger(postId)) {
    return { error: "Select a valid published post." };
  }

  if (!recordedBy) {
    return { error: "Your name is required for the audit trail." };
  }

  let capturedAt;
  const metrics = {} as Record<
    (typeof metricFields)[number][0],
    number
  >;

  try {
    capturedAt = parseCapturedAt(formData.get("captured_at"));

    for (const [field, label] of metricFields) {
      metrics[field] = parseMetricCount(
        formData.get(field),
        label,
      );
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Enter valid metric values.",
    };
  }

  const post = await env.linkedinadam_db
    .prepare(`
      SELECT id
      FROM content_drafts
      WHERE id = ?
        AND status = 'published'
    `)
    .bind(postId)
    .first<{ id: number }>();

  if (!post) {
    return {
      error: "Metrics can only be recorded for published posts.",
    };
  }

  const previous = await env.linkedinadam_db
    .prepare(`
      SELECT
        impressions,
        reactions,
        comments,
        reposts,
        clicks,
        qualified_conversations,
        leads
      FROM post_metric_snapshots
      WHERE content_draft_id = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `)
    .bind(postId)
    .first<Record<(typeof metricFields)[number][0], number>>();
  const decreasedMetrics = previous
    ? metricFields
        .filter(([field]) => metrics[field] < previous[field])
        .map(([, label]) => label)
    : [];

  if (decreasedMetrics.length && !notes) {
    return {
      error:
        `Add a correction note because these cumulative metrics decreased: ${decreasedMetrics.join(", ")}.`,
    };
  }

  try {
    await env.linkedinadam_db
      .prepare(`
        INSERT INTO post_metric_snapshots (
          content_draft_id,
          captured_at,
          impressions,
          reactions,
          comments,
          reposts,
          clicks,
          qualified_conversations,
          leads,
          source,
          recorded_by,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
      `)
      .bind(
        postId,
        capturedAt,
        metrics.impressions,
        metrics.reactions,
        metrics.comments,
        metrics.reposts,
        metrics.clicks,
        metrics.qualified_conversations,
        metrics.leads,
        recordedBy,
        notes || null,
      )
      .run();
  } catch (error) {
    console.error("Metric snapshot insert failed.", error);

    return {
      error:
        "The snapshot could not be saved. Confirm the capture time is unique for this post.",
    };
  }

  return redirect(`/analytics?post=${postId}`);
}

export default function Analytics({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    posts,
    snapshotHistory,
    selectedPostId,
    range,
    currentLocalDateTime,
  } = loaderData;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const employeeFilter = searchParams.get("employee") ?? "all";
  const formatFilter = searchParams.get("format") ?? "all";
  const imageFilter = searchParams.get("image") ?? "all";
  const measuredPosts = posts.filter((post) => post.captured_at);
  const filteredPosts = measuredPosts.filter((post) => {
    const employeeMatches =
      employeeFilter === "all" ||
      post.employee_name === employeeFilter;
    const formatMatches =
      formatFilter === "all" ||
      post.post_format === formatFilter;
    const imageMatches =
      imageFilter === "all" ||
      (imageFilter === "with" && post.image_key) ||
      (imageFilter === "without" && !post.image_key);

    return employeeMatches && formatMatches && imageMatches;
  });
  const summary = summarizePosts(filteredPosts);
  const employeeGroups = groupPostPerformance(
    filteredPosts,
    (post) => post.employee_name,
  );
  const formatGroups = groupPostPerformance(
    filteredPosts,
    (post) =>
      post.post_format === "short_post"
        ? "Short post"
        : "Original post",
  );
  const topicGroups = groupPostPerformance(
    filteredPosts.filter((post) => post.topic),
    (post) => post.topic as string,
  );
  const imageGroups = groupPostPerformance(
    filteredPosts,
    (post) => (post.image_key ? "With image" : "Without image"),
  );
  const insights = buildContentInsights(filteredPosts);
  const employees = Array.from(
    new Set(posts.map((post) => post.employee_name)),
  ).sort();
  const selectedPost =
    posts.find((post) => post.id === selectedPostId) ?? null;
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="analytics-page">
      <header className="analytics-header">
        <div>
          <Link className="back-link" to="/">
            ← Dashboard
          </Link>
          <p className="eyebrow">CONTENT INTELLIGENCE</p>
          <h1>Post performance</h1>
          <p>
            Analyze the latest cumulative snapshot for each
            published post. Comparisons show association, not
            causation.
          </p>
        </div>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}

      <section className="analytics-toolbar panel">
        <Form method="get" className="analytics-filters">
          <select name="range" defaultValue={range}>
            <option value="30">Published in last 30 days</option>
            <option value="90">Published in last 90 days</option>
            <option value="all">All published posts</option>
          </select>
          <select name="employee" defaultValue={employeeFilter}>
            <option value="all">All employees</option>
            {employees.map((employee) => (
              <option key={employee} value={employee}>
                {employee}
              </option>
            ))}
          </select>
          <select name="format" defaultValue={formatFilter}>
            <option value="all">All formats</option>
            <option value="original_post">Original posts</option>
            <option value="short_post">Short posts</option>
          </select>
          <select name="image" defaultValue={imageFilter}>
            <option value="all">With or without image</option>
            <option value="with">With image</option>
            <option value="without">Without image</option>
          </select>
          <button type="submit">Apply filters</button>
        </Form>
      </section>

      <section className="analytics-stats">
        <article><span>Measured posts</span><strong>{summary.measuredPosts}</strong></article>
        <article><span>Impressions</span><strong>{formatNumber(summary.impressions)}</strong></article>
        <article><span>Engagement rate</span><strong>{formatPercent(summary.engagementRate)}</strong></article>
        <article><span>Click rate</span><strong>{formatPercent(summary.clickRate)}</strong></article>
        <article><span>Conversations</span><strong>{summary.qualified_conversations}</strong></article>
        <article><span>Leads</span><strong>{summary.leads}</strong></article>
      </section>

      <section className="analytics-grid">
        <article className="panel metric-entry-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MANUAL SNAPSHOT</p>
              <h2>Record cumulative metrics</h2>
            </div>
          </div>

          {posts.length ? (
            <Form method="post" className="metric-entry-form">
              <label className="metric-entry-wide">
                Published post
                <select
                  name="content_draft_id"
                  defaultValue={selectedPostId ?? ""}
                  required
                >
                  {posts.map((post) => (
                    <option key={post.id} value={post.id}>
                      {post.employee_name} — {post.title || "Untitled post"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Captured ({ANALYTICS_TIME_ZONE})
                <input
                  type="datetime-local"
                  name="captured_at"
                  defaultValue={currentLocalDateTime}
                  required
                />
              </label>
              {metricFields.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type="number"
                    name={field}
                    min="0"
                    step="1"
                    defaultValue="0"
                    required
                  />
                </label>
              ))}
              <label>
                Recorded by
                <input
                  type="text"
                  name="recorded_by"
                  defaultValue="Adam Copenhaver"
                  required
                />
              </label>
              <label className="metric-entry-wide">
                Notes
                <input
                  type="text"
                  name="notes"
                  placeholder="Required when correcting a lower cumulative value"
                />
              </label>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save snapshot"}
              </button>
            </Form>
          ) : (
            <div className="empty-state">
              Publish a post before recording metrics.
            </div>
          )}
        </article>

        <article className="panel insight-panel">
          <p className="eyebrow">EVIDENCE-BASED LEARNING</p>
          <h2>Current signals</h2>
          <div className="insight-list">
            {insights.map((insight) => (
              <p key={insight}>{insight}</p>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">POST LEADERBOARD</p>
            <h2>Latest performance</h2>
          </div>
        </div>
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Impressions</th>
                <th>Engagement</th>
                <th>Clicks</th>
                <th>Conversations</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {filteredPosts
                .slice()
                .sort(
                  (left, right) =>
                    (
                      summarizePosts([right]).engagementRate ?? -1
                    ) - (
                      summarizePosts([left]).engagementRate ?? -1
                    ),
                )
                .map((post) => {
                  const postSummary = summarizePosts([post]);

                  return (
                    <tr key={post.id}>
                      <td>
                        <strong>{post.title || "Untitled post"}</strong>
                        <span>{post.employee_name}</span>
                      </td>
                      <td>{formatNumber(post.impressions)}</td>
                      <td>{formatPercent(postSummary.engagementRate)}</td>
                      <td>{formatPercent(postSummary.clickRate)}</td>
                      <td>{post.qualified_conversations}</td>
                      <td>{post.leads}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="analytics-breakdowns">
        {[
          ["By employee", employeeGroups],
          ["By format", formatGroups],
          ["By topic", topicGroups],
          ["Image comparison", imageGroups],
        ].map(([heading, groups]) => (
          <article className="panel" key={heading as string}>
            <h2>{heading as string}</h2>
            <div className="breakdown-list">
              {(groups as typeof employeeGroups).length ? (
                (groups as typeof employeeGroups).map((group) => (
                  <div key={group.label}>
                    <strong>{group.label}</strong>
                    <span>
                      {group.measuredPosts} posts ·{" "}
                      {formatPercent(group.engagementRate)}
                    </span>
                  </div>
                ))
              ) : (
                <p>No measured posts in this segment.</p>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SNAPSHOT HISTORY</p>
            <h2>
              {selectedPost?.title || "Select a published post"}
            </h2>
          </div>
          {selectedPost?.linkedin_post_url ? (
            <a
              className="published-link"
              href={selectedPost.linkedin_post_url}
              target="_blank"
              rel="noreferrer"
            >
              Open LinkedIn post ↗
            </a>
          ) : null}
        </div>

        <Form method="get" className="history-post-picker">
          <input type="hidden" name="range" value={range} />
          <select name="post" defaultValue={selectedPostId ?? ""}>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.employee_name} — {post.title || "Untitled post"}
              </option>
            ))}
          </select>
          <button type="submit">View history</button>
        </Form>

        <div className="snapshot-history-list">
          {snapshotHistory.length ? (
            snapshotHistory.map((snapshot) => (
              <article key={snapshot.id}>
                <strong>{snapshot.captured_at}</strong>
                <span>
                  {formatNumber(snapshot.impressions)} impressions ·{" "}
                  {snapshot.reactions} reactions ·{" "}
                  {snapshot.comments} comments ·{" "}
                  {snapshot.reposts} reposts ·{" "}
                  {snapshot.clicks} clicks
                </span>
                <small>
                  Recorded by {snapshot.recorded_by} · {snapshot.source}
                </small>
                {snapshot.notes ? <p>{snapshot.notes}</p> : null}
              </article>
            ))
          ) : (
            <div className="empty-state">
              No metric snapshots recorded for this post.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
