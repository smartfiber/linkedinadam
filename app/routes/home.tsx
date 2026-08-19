import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { getSafeOpenAIErrorMessage } from "../lib/aiErrors.server";
import { generateLinkedInImage } from "../lib/generateLinkedInImage.server";
import { generateLinkedInPost } from "../lib/generateLinkedInPost.server";
import { decryptLinkedInToken } from "../lib/linkedinCrypto.server";
import {
  getSafeLinkedInErrorMessage,
  LinkedInAPIError,
} from "../lib/linkedinErrors.server";
import { publishLinkedInPost } from "../lib/linkedinPublishing.server";
import {
  getPublishBlocker,
  normalizeScheduledFor,
} from "../lib/contentWorkflow";
import { findScheduleConflict } from "../lib/contentWorkflow.server";

type Employee = {
  id: number;
  name: string;
  email: string | null;
  linkedin_profile_url: string | null;
  role_name: string;
  status: string;
  playbook_id: number | null;
  primary_audience: string | null;
  primary_expertise: string | null;
  positioning_statement: string | null;
  recurring_series: string | null;
  weekly_original_posts: number;
  weekly_short_posts: number;
  weekly_meaningful_comments: number;
  weekly_new_connections: number;
  original_posts_completed: number;
  short_posts_completed: number;
  meaningful_comments_completed: number;
  relevant_connections_completed: number;
  qualified_conversations: number;
  leads_handed_off: number;
  lead_magnet: string | null;
  soft_cta: string | null;
  qualified_buying_signal: string | null;
  lead_handoff_action: string | null;
  guardrail: string | null;
  writing_style_prompt: string | null;
};

type AppEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
  LINKEDIN_IMAGES: R2Bucket;
  LINKEDIN_TOKEN_ENCRYPTION_KEY?: string;
};

type PlaybookOption = {
  id: number;
  role_name: string;
};

type ContentDraft = {
  id: number;
  employee_id: number;
  employee_name: string;
  title: string | null;
  body: string;
  post_format: string | null;
  topic: string | null;
  status: string;
  scheduled_for: string | null;
  approved_at: string | null;
  published_at: string | null;
  linkedin_post_url: string | null;
  linkedin_post_urn: string | null;
  image_key: string | null;
  image_prompt: string | null;
  image_status: string | null;
  image_mime_type: string | null;
  image_updated_at: string | null;
  image_alt_text: string | null;
  linkedin_connection_id: number | null;
  linkedin_connection_name: string | null;
  linkedin_connection_status: string | null;
  linkedin_connection_expires_at: string | null;
  linkedin_publish_attempt_status: string | null;
  linkedin_publish_attempt_error: string | null;
  created_at: string;
};

type ContentReviewHistory = {
  id: number;
  content_draft_id: number;
  from_status: string | null;
  to_status: string;
  reviewer_name: string | null;
  review_note: string | null;
  created_at: string;
};

type DailyHomeDraft = {
  id: number;
  employee_name: string;
  title: string | null;
  body: string;
  status: string;
  scheduled_for: string;
};

type ActivityEvent = {
  id: number;
  employee_name: string;
  event_type: string;
  source: string;
  description: string | null;
  content_url: string | null;
  occurred_at: string;
};

const agents = [
  {
    name: "Strategy Agent",
    description: "Assigns role, audience, positioning, targets, and guardrails.",
  },
  {
    name: "Content Planner",
    description: "Builds weekly post plans and prevents duplicate topics.",
  },
  {
    name: "Post Drafting Agent",
    description: "Drafts posts in each employee’s approved voice.",
  },
  {
    name: "Connection Targeting Agent",
    description: "Finds relevant people each employee should connect with.",
  },
  {
    name: "Engagement Queue Agent",
    description: "Surfaces posts and conversations worth engaging with.",
  },
  {
    name: "Conversation Signal Agent",
    description: "Detects buying signals, interest, and lead potential.",
  },
  {
    name: "Messaging Agent",
    description: "Drafts public replies and private follow-up messages.",
  },
  {
    name: "Lead Routing Agent",
    description: "Routes qualified conversations to the right owner.",
  },
];

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  now.setUTCDate(now.getUTCDate() - daysSinceMonday);

  return now.toISOString().slice(0, 10);
}

function getCurrentChicagoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const weekStart = getCurrentWeekStart();

  const employeeQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        e.id,
        e.name,
        e.email,
        e.linkedin_profile_url,
        e.role_name,
        e.status,
        p.id AS playbook_id,
        p.primary_audience,
        p.primary_expertise,
        p.positioning_statement,
        p.recurring_series,
        COALESCE(p.weekly_original_posts, 0) AS weekly_original_posts,
        COALESCE(p.weekly_short_posts, 0) AS weekly_short_posts,
        COALESCE(p.weekly_meaningful_comments, 0) AS weekly_meaningful_comments,
        COALESCE(p.weekly_new_connections, 0) AS weekly_new_connections,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'original_post' THEN 1 ELSE 0 END
        ), 0) AS original_posts_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'short_post' THEN 1 ELSE 0 END
        ), 0) AS short_posts_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'meaningful_comment' THEN 1 ELSE 0 END
        ), 0) AS meaningful_comments_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'relevant_connection' THEN 1 ELSE 0 END
        ), 0) AS relevant_connections_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'qualified_conversation' THEN 1 ELSE 0 END
        ), 0) AS qualified_conversations,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'lead_handoff' THEN 1 ELSE 0 END
        ), 0) AS leads_handed_off,
        p.lead_magnet,
        p.soft_cta,
        p.qualified_buying_signal,
        p.lead_handoff_action,
        p.guardrail,
        COALESCE(
          e.writing_style_prompt_override,
          p.writing_style_prompt
        ) AS writing_style_prompt
      FROM employees e
      LEFT JOIN employee_playbooks ep
        ON ep.employee_id = e.id
      LEFT JOIN playbooks p
        ON p.id = ep.playbook_id
      LEFT JOIN activity_events a
        ON a.employee_id = e.id
        AND date(a.occurred_at) >= ?
        AND date(a.occurred_at) < date(?, '+7 days')
      GROUP BY
        e.id,
        e.name,
        e.email,
        e.linkedin_profile_url,
        e.role_name,
        e.status,
        p.id,
        p.primary_audience,
        p.primary_expertise,
        p.positioning_statement,
        p.recurring_series,
        p.weekly_original_posts,
        p.weekly_short_posts,
        p.weekly_meaningful_comments,
        p.weekly_new_connections,
        p.lead_magnet,
        p.soft_cta,
        p.qualified_buying_signal,
        p.lead_handoff_action,
        p.guardrail,
        p.writing_style_prompt,
        e.writing_style_prompt_override
      ORDER BY e.name ASC
    `)
    .bind(weekStart, weekStart)
    .all<Employee>();

  const playbookQuery = await env.linkedinadam_db
    .prepare(`
      SELECT id, role_name
      FROM playbooks
      ORDER BY role_name ASC
    `)
    .all<PlaybookOption>();

  const contentQuery = await env.linkedinadam_db
    .prepare(`
      WITH latest_linkedin_attempt AS (
        SELECT
          a.*,
          ROW_NUMBER() OVER (
            PARTITION BY a.content_draft_id
            ORDER BY a.created_at DESC, a.id DESC
          ) AS attempt_rank
        FROM linkedin_publish_attempts a
      )
      SELECT
        c.id,
        c.employee_id,
        e.name AS employee_name,
        c.title,
        c.body,
        c.post_format,
        c.topic,
        c.status,
        c.scheduled_for,
        c.approved_at,
        c.published_at,
        c.linkedin_post_url,
        c.linkedin_post_urn,
        c.image_key,
        c.image_prompt,
        c.image_status,
        c.image_mime_type,
        c.image_updated_at,
        c.image_alt_text,
        lc.id AS linkedin_connection_id,
        lc.display_name AS linkedin_connection_name,
        CASE
          WHEN lc.status = 'active'
            AND lc.expires_at <= CURRENT_TIMESTAMP
          THEN 'expired'
          ELSE lc.status
        END AS linkedin_connection_status,
        lc.expires_at AS linkedin_connection_expires_at,
        la.status AS linkedin_publish_attempt_status,
        la.safe_error_code AS linkedin_publish_attempt_error,
        c.created_at
      FROM content_drafts c
      JOIN employees e
        ON e.id = c.employee_id
      LEFT JOIN linkedin_connections lc
        ON lc.employee_id = c.employee_id
      LEFT JOIN latest_linkedin_attempt la
        ON la.content_draft_id = c.id
        AND la.attempt_rank = 1
      ORDER BY
        CASE c.status
          WHEN 'approved' THEN 1
          WHEN 'draft' THEN 2
          WHEN 'published' THEN 3
          ELSE 4
        END,
        c.created_at DESC
      LIMIT 30
    `)
    .all<ContentDraft>();

  const reviewHistoryQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        id,
        content_draft_id,
        from_status,
        to_status,
        reviewer_name,
        review_note,
        created_at
      FROM content_review_history
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `)
    .all<ContentReviewHistory>();

  const activityQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        a.id,
        e.name AS employee_name,
        a.event_type,
        a.source,
        a.description,
        a.content_url,
        a.occurred_at
      FROM activity_events a
      JOIN employees e
        ON e.id = a.employee_id
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT 25
    `)
    .all<ActivityEvent>();
  const today = getCurrentChicagoDate();
  const dayAfterTomorrow = addDateDays(today, 2);
  const dailyQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        c.id,
        e.name AS employee_name,
        c.title,
        c.body,
        c.status,
        c.scheduled_for
      FROM content_drafts c
      JOIN employees e ON e.id = c.employee_id
      WHERE c.scheduled_for >= ?
        AND c.scheduled_for < ?
        AND e.status = 'active'
      ORDER BY c.scheduled_for, e.name
    `)
    .bind(`${today}T00:00`, `${dayAfterTomorrow}T00:00`)
    .all<DailyHomeDraft>();

  return {
    employees: employeeQuery.results ?? [],
    playbooks: playbookQuery.results ?? [],
    recentActivities: activityQuery.results ?? [],
    contentDrafts: contentQuery.results ?? [],
    reviewHistory: reviewHistoryQuery.results ?? [],
    dailyDrafts: dailyQuery.results ?? [],
    today,
    tomorrow: addDateDays(today, 1),
    weekStart,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "add_employee");

  if (intent === "publish_to_linkedin") {
    const draftId = Number(formData.get("draft_id"));
    const requestedBy = String(
      formData.get("requested_by") ?? "",
    ).trim();
    const confirmed =
      String(formData.get("confirm_publication") ?? "") === "yes";
    const imageAltText = String(
      formData.get("image_alt_text") ?? "",
    ).trim();

    if (!Number.isInteger(draftId)) {
      return { error: "Select a valid content draft." };
    }

    if (!requestedBy) {
      return { error: "Publisher name is required." };
    }

    if (!confirmed) {
      return {
        error:
          "Confirm that you intend to publish this approved post publicly on LinkedIn.",
      };
    }

    if (!env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
      return {
        error: "LinkedIn token encryption is not configured.",
      };
    }

    const draft = await env.linkedinadam_db
      .prepare(`
        SELECT
          c.id,
          c.employee_id,
          c.title,
          c.body,
          c.post_format,
          c.status,
          c.scheduled_for,
          c.image_key,
          c.image_status,
          c.image_mime_type,
          lc.id AS connection_id,
          lc.linkedin_person_urn,
          lc.access_token_ciphertext,
          lc.access_token_iv,
          lc.expires_at,
          lc.status AS connection_status
        FROM content_drafts c
        LEFT JOIN linkedin_connections lc
          ON lc.employee_id = c.employee_id
        WHERE c.id = ?
      `)
      .bind(draftId)
      .first<{
        id: number;
        employee_id: number;
        title: string | null;
        body: string;
        post_format: string | null;
        status: string;
        scheduled_for: string | null;
        image_key: string | null;
        image_status: string | null;
        image_mime_type: string | null;
        connection_id: number | null;
        linkedin_person_urn: string | null;
        access_token_ciphertext: string | null;
        access_token_iv: string | null;
        expires_at: string | null;
        connection_status: string | null;
      }>();

    if (!draft) {
      return { error: "The content draft could not be found." };
    }

    const publishBlocker = getPublishBlocker(draft);

    if (publishBlocker) {
      return { error: publishBlocker };
    }

    if (
      !draft.connection_id ||
      !draft.linkedin_person_urn ||
      !draft.access_token_ciphertext ||
      !draft.access_token_iv
    ) {
      return {
        error:
          "Connect this employee’s LinkedIn account before publishing.",
      };
    }

    if (
      draft.connection_status !== "active" ||
      !draft.expires_at ||
      draft.expires_at <=
        new Date().toISOString().slice(0, 19).replace("T", " ")
    ) {
      return {
        error:
          "This employee’s LinkedIn connection has expired or was disconnected. Reconnect it before publishing.",
      };
    }

    if (draft.image_key && !imageAltText) {
      return {
        error:
          "Add meaningful alt text before publishing an image to LinkedIn.",
      };
    }

    let attempt: { id: number } | null;

    try {
      attempt = await env.linkedinadam_db
        .prepare(`
          INSERT INTO linkedin_publish_attempts (
            content_draft_id,
            linkedin_connection_id,
            requested_by,
            status
          )
          VALUES (?, ?, ?, 'pending')
          RETURNING id
        `)
        .bind(draft.id, draft.connection_id, requestedBy)
        .first<{ id: number }>();
    } catch (error) {
      console.error(
        "LinkedIn publish attempt reservation failed.",
        error instanceof Error ? error.name : "unknown",
      );

      return {
        error:
          "This draft already has an active, successful, or uncertain LinkedIn publication attempt.",
      };
    }

    if (!attempt) {
      return {
        error: "The LinkedIn publication attempt could not be created.",
      };
    }

    let accessToken: string;
    let image:
      | {
          bytes: ArrayBuffer;
          mimeType: string;
          altText: string;
        }
      | undefined;

    try {
      accessToken = await decryptLinkedInToken(
        draft.access_token_ciphertext,
        draft.access_token_iv,
        env.LINKEDIN_TOKEN_ENCRYPTION_KEY,
      );

      if (draft.image_key) {
        const storedImage = await env.LINKEDIN_IMAGES.get(
          draft.image_key,
        );

        if (!storedImage || !("body" in storedImage)) {
          throw new Error("approved_image_missing");
        }

        image = {
          bytes: await storedImage.arrayBuffer(),
          mimeType:
            draft.image_mime_type ||
            storedImage.httpMetadata?.contentType ||
            "image/png",
          altText: imageAltText,
        };
      }
    } catch (error) {
      console.error(
        "LinkedIn publication preparation failed.",
        error instanceof Error ? error.name : "unknown",
      );
      await env.linkedinadam_db
        .prepare(`
          UPDATE linkedin_publish_attempts
          SET
            status = 'failed',
            safe_error_code = 'preparation_failed',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(attempt.id)
        .run();

      return {
        error:
          "The approved image or encrypted LinkedIn connection could not be prepared for publication.",
      };
    }

    let linkedinAccepted = false;

    try {
      const published = await publishLinkedInPost({
        accessToken,
        personUrn: draft.linkedin_person_urn,
        commentary: draft.body,
        image,
      });
      linkedinAccepted = true;
      const eventType =
        draft.post_format === "short_post"
          ? "short_post"
          : "original_post";

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE linkedin_publish_attempts
            SET
              status = 'succeeded',
              linkedin_image_urn = ?,
              linkedin_post_urn = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
          `)
          .bind(
            published.imageUrn,
            published.postUrn,
            attempt.id,
          ),
        env.linkedinadam_db
          .prepare(`
            UPDATE content_drafts
            SET
              status = 'published',
              published_at = CURRENT_TIMESTAMP,
              linkedin_post_url = ?,
              linkedin_post_urn = ?,
              image_alt_text = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'approved'
          `)
          .bind(
            published.postUrl,
            published.postUrn,
            imageAltText || null,
            draft.id,
          ),
        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_review_history (
              content_draft_id,
              from_status,
              to_status,
              reviewer_name,
              review_note
            )
            VALUES (?, 'approved', 'published', ?,
              'Published directly through LinkedInAdam')
          `)
          .bind(draft.id, requestedBy),
        env.linkedinadam_db
          .prepare(`
            INSERT OR IGNORE INTO activity_events (
              employee_id,
              event_type,
              source,
              external_action_id,
              content_url,
              description,
              metadata,
              occurred_at
            )
            VALUES (?, ?, 'linkedin', ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `)
          .bind(
            draft.employee_id,
            eventType,
            published.postUrn,
            published.postUrl,
            draft.title || "Published through LinkedInAdam",
            JSON.stringify({
              publication_method: "linkedin_api",
              publish_attempt_id: attempt.id,
            }),
          ),
      ]);

      return redirect("/#content");
    } catch (error) {
      const uncertain =
        linkedinAccepted ||
        (error instanceof LinkedInAPIError && error.uncertain);
      const safeCode =
        linkedinAccepted
          ? "publication_recording_failed"
          : error instanceof LinkedInAPIError
          ? error.code
          : "unexpected_error";

      console.error(
        "LinkedIn publication failed.",
        safeCode,
      );

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE linkedin_publish_attempts
            SET
              status = ?,
              safe_error_code = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
          `)
          .bind(
            uncertain ? "uncertain" : "failed",
            safeCode,
            attempt.id,
          ),
        ...(error instanceof LinkedInAPIError &&
        error.status === 401
          ? [
              env.linkedinadam_db
                .prepare(`
                  UPDATE linkedin_connections
                  SET status = 'expired',
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                `)
                .bind(draft.connection_id),
            ]
          : []),
      ]);

      return {
        error: getSafeLinkedInErrorMessage(error),
      };
    }
  }

  if (intent === "resolve_linkedin_attempt") {
    const draftId = Number(formData.get("draft_id"));
    const requestedBy = String(
      formData.get("requested_by") ?? "",
    ).trim();
    const resolutionNote = String(
      formData.get("resolution_note") ?? "",
    ).trim();

    if (
      !Number.isInteger(draftId) ||
      !requestedBy ||
      !resolutionNote
    ) {
      return {
        error:
          "Your name and a verification note are required to resolve an uncertain attempt.",
      };
    }

    const result = await env.linkedinadam_db
      .prepare(`
        UPDATE linkedin_publish_attempts
        SET
          status = 'resolved_not_published',
          resolution_note = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE content_draft_id = ?
          AND status = 'uncertain'
      `)
      .bind(
        `${requestedBy}: ${resolutionNote}`,
        draftId,
      )
      .run();

    if (!result.meta.changes) {
      return {
        error: "No uncertain LinkedIn attempt was found.",
      };
    }

    return redirect("/#content");
  }

  if (intent === "generate_content_image") {
    const draftId = Number(formData.get("draft_id"));
    const style = String(
      formData.get("image_style") ?? "editorial",
    );
    const customInstructions = String(
      formData.get("custom_instructions") ?? "",
    ).trim();

    const allowedStyles = [
      "editorial",
      "branded",
      "photorealistic",
      "diagram",
    ];

    if (!Number.isInteger(draftId)) {
      return {
        error: "Select a valid content draft.",
      };
    }

    if (!allowedStyles.includes(style)) {
      return {
        error: "Select a valid image style.",
      };
    }

    if (!env.OPENAI_API_KEY) {
      return {
        error: "The OpenAI API key is not configured.",
      };
    }

    let draft;

    try {
      draft = await env.linkedinadam_db
        .prepare(`
          SELECT
            c.id,
            c.title,
            c.topic,
            c.body,
            c.image_key,
            e.name AS employee_name,
            e.role_name
          FROM content_drafts c
          JOIN employees e
            ON e.id = c.employee_id
          WHERE c.id = ?
        `)
        .bind(draftId)
        .first<{
          id: number;
          title: string | null;
          topic: string | null;
          body: string;
          image_key: string | null;
          employee_name: string;
          role_name: string;
        }>();
    } catch (error) {
      console.error("Content draft lookup failed.", error);

      return {
        error: "The content draft could not be loaded from the database.",
      };
    }

    if (!draft) {
      return {
        error: "The content draft could not be found.",
      };
    }

    let generated;

    try {
      generated = await generateLinkedInImage({
        apiKey: env.OPENAI_API_KEY,
        employeeName: draft.employee_name,
        roleName: draft.role_name,
        topic: draft.topic || draft.title,
        postBody: draft.body,
        style: style as
          | "editorial"
          | "branded"
          | "photorealistic"
          | "diagram",
        customInstructions: customInstructions || null,
      });
    } catch (error) {
      console.error("OpenAI image generation failed.", error);

      return {
        error: getSafeOpenAIErrorMessage(error, "image"),
      };
    }

    const imageKey =
      `content-drafts/${draftId}/${crypto.randomUUID()}.png`;

    try {
      await env.LINKEDIN_IMAGES.put(
        imageKey,
        generated.bytes,
        {
          httpMetadata: {
            contentType: generated.mimeType,
          },
          customMetadata: {
            draftId: String(draftId),
            employeeName: draft.employee_name,
          },
        },
      );
    } catch (error) {
      console.error("Generated image upload failed.", error);

      return {
        error:
          "The image was generated, but it could not be saved to image storage. Try again.",
      };
    }

    try {
      await env.linkedinadam_db
        .prepare(`
          UPDATE content_drafts
          SET
            image_key = ?,
            image_prompt = ?,
            image_status = 'generated',
            image_mime_type = ?,
            image_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          imageKey,
          generated.prompt,
          generated.mimeType,
          draftId,
        )
        .run();
    } catch (error) {
      console.error("Generated image database update failed.", error);

      try {
        await env.LINKEDIN_IMAGES.delete(imageKey);
      } catch (cleanupError) {
        console.error(
          "Generated image cleanup after database failure failed.",
          cleanupError,
        );
      }

      return {
        error:
          "The image was saved, but the content draft could not be updated. The new image was not attached.",
      };
    }

    if (draft.image_key && draft.image_key !== imageKey) {
      try {
        await env.LINKEDIN_IMAGES.delete(draft.image_key);
      } catch (error) {
        console.error("Previous generated image cleanup failed.", error);
      }
    }

    return redirect("/#content");
  }

  if (intent === "approve_content_image") {
    const draftId = Number(formData.get("draft_id"));

    if (!Number.isInteger(draftId)) {
      return {
        error: "Select a valid content draft.",
      };
    }

    let result;

    try {
      result = await env.linkedinadam_db
        .prepare(`
          UPDATE content_drafts
          SET
            image_status = 'approved',
            image_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND image_key IS NOT NULL
            AND image_status = 'generated'
        `)
        .bind(draftId)
        .run();
    } catch (error) {
      console.error("Image approval database update failed.", error);

      return {
        error: "The image approval could not be saved to the database.",
      };
    }

    if (!result.meta.changes) {
      return {
        error: "Only a generated image can be approved.",
      };
    }

    return redirect("/#content");
  }

  if (intent === "remove_content_image") {
    const draftId = Number(formData.get("draft_id"));

    if (!Number.isInteger(draftId)) {
      return {
        error: "Select a valid content draft.",
      };
    }

    let draft;

    try {
      draft = await env.linkedinadam_db
        .prepare(`
          SELECT image_key
          FROM content_drafts
          WHERE id = ?
        `)
        .bind(draftId)
        .first<{
          image_key: string | null;
        }>();
    } catch (error) {
      console.error("Image removal draft lookup failed.", error);

      return {
        error: "The content draft could not be loaded from the database.",
      };
    }

    if (!draft) {
      return {
        error: "The content draft could not be found.",
      };
    }

    try {
      await env.linkedinadam_db
        .prepare(`
          UPDATE content_drafts
          SET
            image_key = NULL,
            image_prompt = NULL,
            image_status = NULL,
            image_mime_type = NULL,
            image_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(draftId)
        .run();
    } catch (error) {
      console.error("Image removal database update failed.", error);

      return {
        error: "The image could not be removed from the content draft.",
      };
    }

    if (draft.image_key) {
      try {
        await env.LINKEDIN_IMAGES.delete(draft.image_key);
      } catch (error) {
        console.error("Removed image object cleanup failed.", error);
      }
    }

    return redirect("/#content");
  }

  if (intent === "generate_content_draft") {
    const employeeId = Number(formData.get("employee_id"));
    const title = String(formData.get("title") ?? "").trim();
    const topic = String(formData.get("topic") ?? "").trim();
    const postFormat = String(
      formData.get("post_format") ?? "original_post",
    );
    let scheduledFor;

    try {
      scheduledFor = normalizeScheduledFor(
        String(formData.get("scheduled_for") ?? ""),
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Choose a valid schedule date and time.",
      };
    }

    if (!Number.isInteger(employeeId)) {
      return {
        error: "Select a valid employee.",
      };
    }

    if (!topic) {
      return {
        error: "Add a topic before generating a post draft.",
      };
    }

    if (!["original_post", "short_post"].includes(postFormat)) {
      return {
        error: "Select a valid post format.",
      };
    }

    if (!env.OPENAI_API_KEY) {
      return {
        error: "The OpenAI API key is not configured.",
      };
    }

    const scheduleConflict = await findScheduleConflict(
      env.linkedinadam_db,
      employeeId,
      scheduledFor,
    );

    if (scheduleConflict) {
      return {
        error:
          `This employee already has “${scheduleConflict.title || "Untitled post"}” scheduled within 30 minutes of that time.`,
      };
    }

    let employee;

    try {
      employee = await env.linkedinadam_db
        .prepare(`
          SELECT
            e.name,
            e.role_name,
            p.primary_audience,
            p.primary_expertise,
            p.content_sources,
            p.primary_post_formats,
            p.example_topics,
            p.positioning_statement,
            p.recurring_series,
            p.lead_magnet,
            p.soft_cta,
            p.guardrail,
            COALESCE(
              e.writing_style_prompt_override,
              p.writing_style_prompt
            ) AS writing_style_prompt
          FROM employees e
          LEFT JOIN employee_playbooks ep
            ON ep.employee_id = e.id
          LEFT JOIN playbooks p
            ON p.id = ep.playbook_id
          WHERE e.id = ?
        `)
        .bind(employeeId)
        .first<{
          name: string;
          role_name: string;
          primary_audience: string | null;
          primary_expertise: string | null;
          content_sources: string | null;
          primary_post_formats: string | null;
          example_topics: string | null;
          positioning_statement: string | null;
          recurring_series: string | null;
          lead_magnet: string | null;
          soft_cta: string | null;
          guardrail: string | null;
          writing_style_prompt: string | null;
        }>();
    } catch (error) {
      console.error("Employee generation context lookup failed.", error);

      return {
        error:
          "The employee and playbook details could not be loaded from the database.",
      };
    }

    if (!employee) {
      return {
        error: "The selected employee could not be found.",
      };
    }

    let generatedPost;

    try {
      generatedPost = await generateLinkedInPost({
        apiKey: env.OPENAI_API_KEY,
        employeeName: employee.name,
        roleName: employee.role_name,
        topic,
        postFormat: postFormat as "original_post" | "short_post",
        primaryAudience: employee.primary_audience,
        primaryExpertise: employee.primary_expertise,
        contentSources: employee.content_sources,
        primaryPostFormats: employee.primary_post_formats,
        exampleTopics: employee.example_topics,
        positioningStatement: employee.positioning_statement,
        recurringSeries: employee.recurring_series,
        leadMagnet: employee.lead_magnet,
        softCta: employee.soft_cta,
        guardrail: employee.guardrail,
        writingStylePrompt: employee.writing_style_prompt,
      });
    } catch (error) {
      console.error("OpenAI post generation failed.", error);

      return {
        error: getSafeOpenAIErrorMessage(error, "post"),
      };
    }

    try {
      await env.linkedinadam_db
        .prepare(`
          INSERT INTO content_drafts (
            employee_id,
            title,
            body,
            post_format,
            topic,
            scheduled_for,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, 'draft')
        `)
        .bind(
          employeeId,
          title || null,
          generatedPost,
          postFormat,
          topic,
          scheduledFor,
        )
        .run();
    } catch (error) {
      console.error("Generated post database insert failed.", error);

      return {
        error:
          "The post was generated, but the draft could not be saved to the database.",
      };
    }

    return redirect("/#content");
  }

  if (intent === "create_content_draft") {
    const employeeId = Number(formData.get("employee_id"));
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const topic = String(formData.get("topic") ?? "").trim();
    const postFormat = String(
      formData.get("post_format") ?? "original_post",
    );
    let scheduledFor;

    try {
      scheduledFor = normalizeScheduledFor(
        String(formData.get("scheduled_for") ?? ""),
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Choose a valid schedule date and time.",
      };
    }

    if (!Number.isInteger(employeeId)) {
      return {
        error: "Select a valid employee.",
      };
    }

    if (!body) {
      return {
        error: "Post content is required.",
      };
    }

    if (!["original_post", "short_post"].includes(postFormat)) {
      return {
        error: "Select a valid post format.",
      };
    }

    const scheduleConflict = await findScheduleConflict(
      env.linkedinadam_db,
      employeeId,
      scheduledFor,
    );

    if (scheduleConflict) {
      return {
        error:
          `This employee already has “${scheduleConflict.title || "Untitled post"}” scheduled within 30 minutes of that time.`,
      };
    }

    await env.linkedinadam_db
      .prepare(`
        INSERT INTO content_drafts (
          employee_id,
          title,
          body,
          post_format,
          topic,
          scheduled_for,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'draft')
      `)
      .bind(
        employeeId,
        title || null,
        body,
        postFormat,
        topic || null,
        scheduledFor,
      )
      .run();

    return redirect("/#content");
  }

  if (intent === "update_content_status") {
    const draftId = Number(formData.get("draft_id"));
    const nextStatus = String(formData.get("next_status") ?? "");
    const linkedinPostUrl = String(
      formData.get("linkedin_post_url") ?? "",
    ).trim();
    const reviewerName = String(
      formData.get("reviewer_name") ?? "",
    ).trim();
    const reviewNote = String(
      formData.get("review_note") ?? "",
    ).trim();

    if (!Number.isInteger(draftId)) {
      return {
        error: "A valid content draft is required.",
      };
    }

    const draft = await env.linkedinadam_db
      .prepare(`
        SELECT
          id,
          employee_id,
          post_format,
          status,
          title,
          body,
          scheduled_for,
          image_key,
          image_status
        FROM content_drafts
        WHERE id = ?
      `)
      .bind(draftId)
      .first<{
        id: number;
        employee_id: number;
        post_format: string | null;
        status: string;
        title: string | null;
        body: string;
        scheduled_for: string | null;
        image_key: string | null;
        image_status: string | null;
      }>();

    if (!draft) {
      return {
        error: "The content draft could not be found.",
      };
    }

    if (!reviewerName) {
      return {
        error: "Reviewer name is required.",
      };
    }

    if (nextStatus === "approved") {
      if (draft.status !== "draft") {
        return {
          error: "Only drafts can be approved.",
        };
      }

      if (!draft.body.trim()) {
        return {
          error: "Add post copy before approving this draft.",
        };
      }

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE content_drafts
            SET
              status = 'approved',
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(draftId),

        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_review_history (
              content_draft_id,
              from_status,
              to_status,
              reviewer_name,
              review_note
            )
            VALUES (?, 'draft', 'approved', ?, ?)
          `)
          .bind(
            draftId,
            reviewerName,
            reviewNote || null,
          ),

      ]);

      return redirect("/#content");
    }

    if (nextStatus === "draft") {
      if (draft.status !== "approved") {
        return {
          error: "Only approved posts can be returned to draft.",
        };
      }

      if (!reviewNote) {
        return {
          error: "Explain why the post is being returned to draft.",
        };
      }

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE content_drafts
            SET
              status = 'draft',
              approved_at = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(draftId),

        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_review_history (
              content_draft_id,
              from_status,
              to_status,
              reviewer_name,
              review_note
            )
            VALUES (?, 'approved', 'draft', ?, ?)
          `)
          .bind(draftId, reviewerName, reviewNote),
      ]);

      return redirect("/#content");
    }

    if (nextStatus === "published") {
      const publishBlocker = getPublishBlocker(draft);

      if (publishBlocker) {
        return {
          error: publishBlocker,
        };
      }

      if (!linkedinPostUrl) {
        return {
          error: "Add the published LinkedIn URL before marking it published.",
        };
      }

      const eventType =
        draft.post_format === "short_post"
          ? "short_post"
          : "original_post";

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE content_drafts
            SET
              status = 'published',
              published_at = CURRENT_TIMESTAMP,
              linkedin_post_url = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(linkedinPostUrl, draftId),

        env.linkedinadam_db
          .prepare(`
            INSERT OR IGNORE INTO activity_events (
              employee_id,
              event_type,
              source,
              external_action_id,
              content_url,
              description,
              occurred_at
            )
            VALUES (
              ?,
              ?,
              'linkedinadam',
              ?,
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
          `)
          .bind(
            draft.employee_id,
            eventType,
            `content_draft:${draft.id}`,
            linkedinPostUrl,
            draft.title || "Published through LinkedInAdam",
          ),

        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_review_history (
              content_draft_id,
              from_status,
              to_status,
              reviewer_name,
              review_note
            )
            VALUES (?, 'approved', 'published', ?, ?)
          `)
          .bind(
            draftId,
            reviewerName,
            reviewNote || null,
          ),

        env.linkedinadam_db
          .prepare(`
            UPDATE linkedin_publish_attempts
            SET
              status = 'succeeded',
              resolution_note = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE content_draft_id = ?
              AND status = 'uncertain'
          `)
          .bind(
            `Manually verified by ${reviewerName} using ${linkedinPostUrl}`,
            draftId,
          ),
      ]);

      return redirect("/#content");
    }

    return {
      error: "Select a valid content status.",
    };
  }

  if (intent === "log_activity") {
    const employeeId = Number(formData.get("employee_id"));
    const eventType = String(formData.get("event_type") ?? "");
    const description = String(
      formData.get("description") ?? "",
    ).trim();
    const contentUrl = String(
      formData.get("content_url") ?? "",
    ).trim();
    const weekStart = getCurrentWeekStart();

    const activityColumns: Record<string, string> = {
      original_post: "original_posts_completed",
      short_post: "short_posts_completed",
      meaningful_comment: "meaningful_comments_completed",
      relevant_connection: "relevant_connections_completed",
      qualified_conversation: "qualified_conversations",
      lead_handoff: "leads_handed_off",
    };

    const activityColumn = activityColumns[eventType];

    if (!Number.isInteger(employeeId)) {
      return {
        error: "A valid employee is required.",
      };
    }

    if (!activityColumn) {
      return {
        error: "Select a valid activity type.",
      };
    }

    await env.linkedinadam_db.batch([
      env.linkedinadam_db
        .prepare(`
          INSERT INTO activity_events (
            employee_id,
            event_type,
            source,
            content_url,
            description,
            occurred_at
          )
          VALUES (?, ?, 'manual', ?, ?, CURRENT_TIMESTAMP)
        `)
        .bind(
          employeeId,
          eventType,
          contentUrl || null,
          description || null,
        ),

      env.linkedinadam_db
        .prepare(`
          INSERT INTO weekly_activity (
            employee_id,
            week_start,
            ${activityColumn}
          )
          VALUES (?, ?, 1)
          ON CONFLICT(employee_id, week_start)
          DO UPDATE SET
            ${activityColumn} = ${activityColumn} + 1
        `)
        .bind(employeeId, weekStart),
    ]);

    return redirect("/#employees");
  }

  if (intent === "update_activity") {
    const employeeId = Number(formData.get("employee_id"));
    const weekStart = getCurrentWeekStart();

    const toCount = (value: FormDataEntryValue | null) => {
      const count = Number(value ?? 0);

      if (!Number.isFinite(count)) {
        return 0;
      }

      return Math.max(0, Math.floor(count));
    };

    if (!Number.isInteger(employeeId)) {
      return {
        error: "A valid employee is required.",
      };
    }

    const originalPosts = toCount(
      formData.get("original_posts_completed"),
    );
    const shortPosts = toCount(
      formData.get("short_posts_completed"),
    );
    const comments = toCount(
      formData.get("meaningful_comments_completed"),
    );
    const connections = toCount(
      formData.get("relevant_connections_completed"),
    );
    const conversations = toCount(
      formData.get("qualified_conversations"),
    );
    const leads = toCount(formData.get("leads_handed_off"));

    await env.linkedinadam_db
      .prepare(`
        INSERT INTO weekly_activity (
          employee_id,
          week_start,
          original_posts_completed,
          short_posts_completed,
          meaningful_comments_completed,
          relevant_connections_completed,
          qualified_conversations,
          leads_handed_off
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, week_start)
        DO UPDATE SET
          original_posts_completed =
            excluded.original_posts_completed,
          short_posts_completed =
            excluded.short_posts_completed,
          meaningful_comments_completed =
            excluded.meaningful_comments_completed,
          relevant_connections_completed =
            excluded.relevant_connections_completed,
          qualified_conversations =
            excluded.qualified_conversations,
          leads_handed_off =
            excluded.leads_handed_off
      `)
      .bind(
        employeeId,
        weekStart,
        originalPosts,
        shortPosts,
        comments,
        connections,
        conversations,
        leads,
      )
      .run();

    return redirect("/#employees");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const linkedinProfileUrl = String(
    formData.get("linkedin_profile_url") ?? "",
  ).trim();
  const playbookId = Number(formData.get("playbook_id"));

  if (!name) {
    return {
      error: "Employee name is required.",
    };
  }

  if (!Number.isInteger(playbookId)) {
    return {
      error: "Select a valid playbook.",
    };
  }

  const selectedPlaybook = await env.linkedinadam_db
    .prepare(`
      SELECT id, role_name
      FROM playbooks
      WHERE id = ?
    `)
    .bind(playbookId)
    .first<{ id: number; role_name: string }>();

  if (!selectedPlaybook) {
    return {
      error: "The selected playbook could not be found.",
    };
  }

  const employeeInsert = await env.linkedinadam_db
    .prepare(`
      INSERT INTO employees
        (name, email, linkedin_profile_url, role_name)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `)
    .bind(
      name,
      email || null,
      linkedinProfileUrl || null,
      selectedPlaybook.role_name,
    )
    .first<{ id: number }>();

  if (!employeeInsert) {
    return {
      error: "The employee could not be created.",
    };
  }

  await env.linkedinadam_db
    .prepare(`
      INSERT INTO employee_playbooks (
        employee_id,
        playbook_id,
        assigned_at
      )
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(employeeInsert.id, playbookId)
    .run();

  return redirect("/#employees");
}

export default function Home({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const employees = loaderData.employees;
  const playbooks = loaderData.playbooks;
  const recentActivities = loaderData.recentActivities;
  const contentDrafts = loaderData.contentDrafts;
  const reviewHistory = loaderData.reviewHistory;
  const dailyDrafts = loaderData.dailyDrafts;
  const today = loaderData.today;
  const tomorrow = loaderData.tomorrow;
  const weekStart = loaderData.weekStart;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const totalOriginalPosts = employees.reduce(
    (total, employee) => total + employee.weekly_original_posts,
    0,
  );

  const totalComments = employees.reduce(
    (total, employee) => total + employee.weekly_meaningful_comments,
    0,
  );

  const totalConnections = employees.reduce(
    (total, employee) => total + employee.weekly_new_connections,
    0,
  );

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="logo">LinkedInAdam</div>

        <nav>
          <a className="active" href="/">
            Command Center
          </a>
          <a href="/development">Development</a>
          <div className="nav-group">
            <strong>Content &amp; LinkedIn</strong>
            <a href="#content">Content</a>
            <a href="/playbooks">Playbooks</a>
            <a href="/calendar">Calendar</a>
            <a href="/orchestration">Post Orchestration</a>
            <a href="/planner">Planner</a>
            <a href="/connections">Connections</a>
            <a href="#employees">Employees / LinkedIn profiles</a>
            <a href="/analytics">Analytics</a>
            <a href="/operations">Automation / Today &amp; Tomorrow</a>
          </div>
          <div className="nav-group">
            <strong>People &amp; Outreach</strong>
            <a href="#people" className="future-nav">People <small>Coming Soon</small></a>
            <a href="#outreach" className="future-nav">Outreach <small>Coming Soon</small></a>
          </div>
          <div className="nav-group">
            <strong>Workspace</strong>
            <a href="#activity">Activity</a>
            <a href="#add-employee">Add Employee</a>
            <a href="#agents">Agents</a>
          </div>
          <a href="#newsletters" className="future-nav">Newsletters <small>Coming Soon</small></a>
          <a href="#settings" className="future-nav">Settings <small>Coming Soon</small></a>
        </nav>
      </aside>

      <section className="content">
        <header className="header">
          <div>
            <p className="eyebrow">LINKEDIN OPERATIONS CENTER</p>
            <h1>Good morning, Adam.</h1>
            <p>
              Coordinate employee content, connections, engagement,
              conversations, and lead handoffs from one place.
            </p>
          </div>

          <div className="header-actions">
            <a className="button-link" href="/operations">
              Daily operations
            </a>
            <a className="secondary-link" href="/connections">
              Review connections
            </a>
            <a className="secondary-link" href="/playbooks">
              Manage playbooks
            </a>
            <a className="button-link" href="#add-employee">
              Add employee
            </a>
          </div>
        </header>

        <section className="dashboard-daily panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TODAY &amp; TOMORROW</p>
              <h2>Daily post queue</h2>
            </div>
            <a className="secondary-link" href="/operations">
              Open full operations dashboard
            </a>
          </div>
          <div className="dashboard-daily-grid">
            {[
              ["Today", today],
              ["Tomorrow", tomorrow],
            ].map(([label, date]) => {
              const drafts = dailyDrafts.filter((draft) =>
                draft.scheduled_for.startsWith(date),
              );

              return (
                <div key={date}>
                  <h3>{label}</h3>
                  <span>{date}</span>
                  {drafts.length ? (
                    drafts.map((draft) => (
                      <details key={draft.id}>
                        <summary>
                          <div>
                            <strong>{draft.employee_name}</strong>
                            <span>
                              {draft.title || "Untitled post"} ·{" "}
                              {draft.status}
                            </span>
                          </div>
                          <span>{draft.scheduled_for.slice(11)}</span>
                        </summary>
                        <p>
                          {draft.body ||
                            "Post copy has not been generated yet."}
                        </p>
                        <a href={`/content/${draft.id}/edit`}>
                          Edit post
                        </a>
                      </details>
                    ))
                  ) : (
                    <p>No posts scheduled.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="stats">
          <article>
            <span>Active employees</span>
            <strong>{employees.length}</strong>
          </article>

          <article>
            <span>Original posts per week</span>
            <strong>{totalOriginalPosts}</strong>
          </article>

          <article>
            <span>Meaningful comments per week</span>
            <strong>{totalComments}</strong>
          </article>

          <article>
            <span>New connections per week</span>
            <strong>{totalConnections}</strong>
          </article>
        </section>

        <section className="panel" id="employees">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EMPLOYEE PLAYBOOKS</p>
              <h2>Team strategy</h2>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="empty-state">
              <strong>No employees have been added yet.</strong>
              <p>Add the first employee using the form below.</p>
            </div>
          ) : (
            <div className="playbook-list">
              {employees.map((employee) => (
                <details
                  className="playbook-card employee-workspace"
                  key={employee.id}
                  open={employees.length === 1}
                >
                  <summary className="playbook-header">
                    <div>
                      <div className="employee-title-row">
                        <h3>{employee.name}</h3>
                        <span
                          className={
                            employee.status === "active" ? "ready" : "setup"
                          }
                        >
                          {employee.status}
                        </span>
                      </div>

                      <p className="employee-role">{employee.role_name}</p>

                      <p className="employee-contact-line">
                        {employee.email || "No email added"}
                      </p>
                    </div>

                    <div className="playbook-header-actions">
                      <div className="playbook-badge">
                        {employee.playbook_id
                          ? "Playbook assigned"
                          : "Needs playbook"}
                      </div>

                      <a
                        className="edit-employee-link"
                        href={`/employees/${employee.id}`}
                      >
                        Edit employee
                      </a>
                    </div>
                  </summary>

                  {employee.playbook_id ? (
                    <>
                      <div className="target-grid">
                        <div>
                          <strong>{employee.weekly_original_posts}</strong>
                          <span>original posts</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_short_posts}</strong>
                          <span>short posts</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_meaningful_comments}</strong>
                          <span>comments</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_new_connections}</strong>
                          <span>connections</span>
                        </div>
                      </div>

                      <div className="activity-event-panel">
                        <div>
                          <span className="eyebrow">LOG ACTIVITY</span>
                          <h4>Add one completed action</h4>
                        </div>

                        <Form method="post" className="event-form">
                          <input
                            type="hidden"
                            name="intent"
                            value="log_activity"
                          />

                          <input
                            type="hidden"
                            name="employee_id"
                            value={employee.id}
                          />

                          <label>
                            Activity type
                            <select
                              name="event_type"
                              defaultValue=""
                              required
                            >
                              <option value="" disabled>
                                Select an activity
                              </option>

                              <option value="original_post">
                                Original post
                              </option>

                              <option value="short_post">
                                Short post
                              </option>

                              <option value="meaningful_comment">
                                Meaningful comment
                              </option>

                              <option value="relevant_connection">
                                Relevant connection
                              </option>

                              <option value="qualified_conversation">
                                Qualified conversation
                              </option>

                              <option value="lead_handoff">
                                Lead handed off
                              </option>
                            </select>
                          </label>

                          <label>
                            Description
                            <input
                              type="text"
                              name="description"
                              placeholder="Optional note about the activity"
                            />
                          </label>

                          <label>
                            LinkedIn URL
                            <input
                              type="url"
                              name="content_url"
                              placeholder="https://www.linkedin.com/..."
                            />
                          </label>

                          <button type="submit" disabled={isSubmitting}>
                            {isSubmitting
                              ? "Saving..."
                              : "Log completed activity"}
                          </button>
                        </Form>
                      </div>

                      <div className="strategy-grid">
                        <div className="strategy-item">
                          <span>Primary audience</span>
                          <p>{employee.primary_audience}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Expertise</span>
                          <p>{employee.primary_expertise}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Recurring series</span>
                          <p>{employee.recurring_series}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Lead magnet</span>
                          <p>{employee.lead_magnet}</p>
                        </div>
                      </div>

                      <div className="strategy-callout">
                        <span>Positioning</span>
                        <p>{employee.positioning_statement}</p>
                      </div>

                      <div className="strategy-grid">
                        <div className="strategy-item signal-item">
                          <span>Qualified buying signal</span>
                          <p>{employee.qualified_buying_signal}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Lead handoff</span>
                          <p>{employee.lead_handoff_action}</p>
                        </div>
                      </div>

                      <div className="guardrail">
                        <strong>Guardrail</strong>
                        <p>{employee.guardrail}</p>
                      </div>

                      <div className="strategy-callout writing-style-preview">
                        <span>AI writing style</span>
                        <p>
                          {employee.writing_style_prompt ||
                            "Default credible, conversational professional voice."}
                        </p>
                        <a href="/playbooks">
                          Edit this playbook’s style →
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="empty-playbook">
                      This employee has not been connected to a playbook yet.
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </section>

        <section className="grid-two">
          <article className="panel" id="add-employee">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TEAM SETUP</p>
                <h2>Add an employee</h2>
              </div>
            </div>

            <Form method="post" className="employee-form">
              <input
                type="hidden"
                name="intent"
                value="add_employee"
              />

              <label>
                Employee name
                <input
                  name="name"
                  type="text"
                  placeholder="Employee name"
                  required
                />
              </label>

              <label>
                Assigned playbook
                <select name="playbook_id" defaultValue="" required>
                  <option value="" disabled>
                    Select a playbook
                  </option>

                  {playbooks.map((playbook) => (
                    <option key={playbook.id} value={playbook.id}>
                      {playbook.role_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="employee@company.com"
                />
              </label>

              <label>
                LinkedIn profile
                <input
                  name="linkedin_profile_url"
                  type="url"
                  placeholder="https://www.linkedin.com/in/..."
                />
              </label>

              {actionData?.error ? (
                <p className="form-error">{actionData.error}</p>
              ) : null}

              <button type="submit">Save employee</button>
            </Form>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NEXT ACTIONS</p>
                <h2>Operations queue</h2>
              </div>
            </div>

            <div className="priority-list">
              <div className="priority-row">
                <span>1</span>
                <p>Draft Adam’s first recurring-series post.</p>
              </div>

              <div className="priority-row">
                <span>2</span>
                <p>Generate Adam’s target connection list.</p>
              </div>

              <div className="priority-row">
                <span>3</span>
                <p>Add Josh and assign his implementation playbook.</p>
              </div>

              <div className="priority-row">
                <span>4</span>
                <p>Begin tracking completed weekly activity.</p>
              </div>
            </div>
          </article>
        </section>

        <section className="panel" id="content">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CONTENT WORKFLOW</p>
              <h2>Post draft queue</h2>
            </div>

            <span className="activity-count">
              {contentDrafts.length} drafts
            </span>
          </div>

          {actionData?.error ? (
            <p className="form-error content-workflow-error">
              {actionData.error}
            </p>
          ) : null}

          <div className="content-workflow-grid">
            <Form method="post" className="content-draft-form">
              <label>
                Employee
                <select name="employee_id" defaultValue="" required>
                  <option value="" disabled>
                    Select an employee
                  </option>

                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Post format
                <select
                  name="post_format"
                  defaultValue="original_post"
                >
                  <option value="original_post">
                    Original post
                  </option>
                  <option value="short_post">
                    Short post
                  </option>
                </select>
              </label>

              <label>
                Internal title
                <input
                  name="title"
                  type="text"
                  placeholder="Telecom renewal timing"
                />
              </label>

              <label>
                Topic
                <input
                  name="topic"
                  type="text"
                  placeholder="Procurement, outages, store openings..."
                />
              </label>

              <label>
                Schedule
                <input
                  name="scheduled_for"
                  type="datetime-local"
                />
              </label>

              <label className="content-body-field">
                Post content
                <textarea
                  name="body"
                  rows={10}
                  placeholder="Write or paste the LinkedIn post here..."
                  required
                />
              </label>

              <div className="form-actions">
                <button
                  type="submit"
                  name="intent"
                  value="generate_content_draft"
                  formNoValidate
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "Working..."
                    : "Generate AI draft"}
                </button>

                <button
                  type="submit"
                  name="intent"
                  value="create_content_draft"
                  className="secondary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Create manual draft"}
                </button>
              </div>
            </Form>

            <div className="draft-queue">
              {contentDrafts.length === 0 ? (
                <div className="empty-state">
                  <strong>No drafts yet.</strong>
                  <p>Create the first employee post draft.</p>
                </div>
              ) : (
                contentDrafts.map((draft) => (
                  <details className="draft-card" key={draft.id}>
                    <summary className="draft-card-header">
                      <div>
                        <strong>
                          {draft.title || "Untitled post"}
                        </strong>
                        <p>
                          {draft.employee_name} ·{" "}
                          {draft.post_format === "short_post"
                            ? "Short post"
                            : "Original post"}
                        </p>
                      </div>

                      <span className={`draft-status ${draft.status}`}>
                        {draft.status}
                      </span>
                    </summary>

                    {draft.topic ? (
                      <span className="draft-topic">
                        {draft.topic}
                      </span>
                    ) : null}

                    <p className="draft-body">{draft.body}</p>

                    {draft.scheduled_for ? (
                      <p className="draft-schedule">
                        Scheduled: {draft.scheduled_for}
                      </p>
                    ) : null}

                    <section className="draft-image-workflow">
                      <div className="draft-image-heading">
                        <div>
                          <span className="eyebrow">
                            POST IMAGE
                          </span>
                          <strong>
                            {draft.image_key
                              ? "Generated visual"
                              : "No image generated"}
                          </strong>
                        </div>

                        {draft.image_status ? (
                          <span
                            className={`image-status ${draft.image_status}`}
                          >
                            {draft.image_status}
                          </span>
                        ) : null}
                      </div>

                      {draft.image_key ? (
                        <img
                          className="draft-generated-image"
                          src={`/images/generated/${encodeURIComponent(
                            draft.image_key,
                          )}`}
                          alt={
                            draft.title
                              ? `Generated visual for ${draft.title}`
                              : "Generated LinkedIn post visual"
                          }
                          loading="lazy"
                        />
                      ) : null}

                      {draft.status !== "published" ? (
                        <Form
                          method="post"
                          className="image-generation-form"
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="generate_content_image"
                          />

                          <input
                            type="hidden"
                            name="draft_id"
                            value={draft.id}
                          />

                          <label>
                            Image style
                            <select
                              name="image_style"
                              defaultValue="editorial"
                            >
                              <option value="editorial">
                                Editorial illustration
                              </option>
                              <option value="branded">
                                Branded technology graphic
                              </option>
                              <option value="photorealistic">
                                Photorealistic
                              </option>
                              <option value="diagram">
                                Conceptual diagram
                              </option>
                            </select>
                          </label>

                          <label>
                            Custom instructions
                            <input
                              type="text"
                              name="custom_instructions"
                              placeholder="Optional visual direction"
                            />
                          </label>

                          <button
                            type="submit"
                            disabled={isSubmitting}
                          >
                            {isSubmitting
                              ? "Generating..."
                              : draft.image_key
                                ? "Regenerate image"
                                : "Generate image"}
                          </button>
                        </Form>
                      ) : null}

                      {draft.image_key ? (
                        <div className="image-review-actions">
                          {draft.image_status === "generated" ? (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="approve_content_image"
                              />

                              <input
                                type="hidden"
                                name="draft_id"
                                value={draft.id}
                              />

                              <button
                                type="submit"
                                disabled={isSubmitting}
                              >
                                Approve image
                              </button>
                            </Form>
                          ) : null}

                          {draft.status !== "published" ? (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="remove_content_image"
                              />

                              <input
                                type="hidden"
                                name="draft_id"
                                value={draft.id}
                              />

                              <button
                                type="submit"
                                className="secondary"
                                disabled={isSubmitting}
                              >
                                Remove image
                              </button>
                            </Form>
                          ) : null}
                        </div>
                      ) : null}
                    </section>

                    {draft.status === "draft" ? (
                      <div className="draft-actions">
                        <a
                          className="edit-draft-link"
                          href={`/content/${draft.id}/edit`}
                        >
                          Edit draft
                        </a>

                        <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="update_content_status"
                        />
                        <input
                          type="hidden"
                          name="draft_id"
                          value={draft.id}
                        />
                        <input
                          type="hidden"
                          name="next_status"
                          value="approved"
                        />

                        <input
                          type="text"
                          name="reviewer_name"
                          placeholder="Reviewer name"
                          defaultValue="Adam Copenhaver"
                          required
                        />

                        <input
                          type="text"
                          name="review_note"
                          placeholder="Optional approval note"
                        />

                        <button
                          type="submit"
                          disabled={isSubmitting}
                        >
                          {isSubmitting
                            ? "Saving..."
                            : "Approve post"}
                        </button>
                        </Form>
                      </div>
                    ) : null}

                    {draft.status === "approved" ? (
                      <div className="approved-actions">
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="update_content_status"
                          />
                          <input
                            type="hidden"
                            name="draft_id"
                            value={draft.id}
                          />
                          <input
                            type="hidden"
                            name="next_status"
                            value="draft"
                          />

                          <input
                            type="text"
                            name="reviewer_name"
                            placeholder="Reviewer name"
                            defaultValue="Adam Copenhaver"
                            required
                          />

                          <input
                            type="text"
                            name="review_note"
                            placeholder="What needs to change?"
                            required
                          />

                          <button
                            type="submit"
                            className="secondary"
                            disabled={isSubmitting}
                          >
                            {isSubmitting
                              ? "Saving..."
                              : "Return to draft"}
                          </button>
                        </Form>

                        <section className="linkedin-publish-panel">
                          <div>
                            <span className="eyebrow">
                              LINKEDIN API
                            </span>
                            <strong>
                              {draft.linkedin_connection_name
                                ? `Publish as ${draft.linkedin_connection_name}`
                                : "LinkedIn is not connected"}
                            </strong>
                          </div>

                          {draft.linkedin_connection_status ===
                          "active" ? (
                            <Form
                              method="post"
                              className="linkedin-publish-form"
                            >
                              <input
                                type="hidden"
                                name="intent"
                                value="publish_to_linkedin"
                              />
                              <input
                                type="hidden"
                                name="draft_id"
                                value={draft.id}
                              />
                              <input
                                name="requested_by"
                                defaultValue="Adam Copenhaver"
                                placeholder="Publisher name"
                                required
                              />
                              {draft.image_key ? (
                                <input
                                  name="image_alt_text"
                                  defaultValue={
                                    draft.image_alt_text ?? ""
                                  }
                                  placeholder="Describe the image for screen readers"
                                  maxLength={4086}
                                  required
                                />
                              ) : null}
                              <label className="publish-confirmation">
                                <input
                                  type="checkbox"
                                  name="confirm_publication"
                                  value="yes"
                                  required
                                />
                                Publish this approved post publicly on
                                LinkedIn now
                              </label>
                              <button
                                type="submit"
                                disabled={
                                  isSubmitting ||
                                  ["pending", "uncertain", "succeeded"].includes(
                                    draft.linkedin_publish_attempt_status ??
                                      "",
                                  )
                                }
                              >
                                {isSubmitting
                                  ? "Publishing…"
                                  : "Publish to LinkedIn"}
                              </button>
                            </Form>
                          ) : (
                            <a
                              className="edit-draft-link"
                              href={`/employees/${draft.employee_id}`}
                            >
                              {draft.linkedin_connection_status
                                ? "Reconnect LinkedIn"
                                : "Connect LinkedIn"}
                            </a>
                          )}

                          {draft.linkedin_publish_attempt_status ? (
                            <p className="linkedin-attempt-status">
                              Latest attempt:{" "}
                              {draft.linkedin_publish_attempt_status}
                            </p>
                          ) : null}

                          {draft.linkedin_publish_attempt_status ===
                          "uncertain" ? (
                            <Form
                              method="post"
                              className="linkedin-resolution-form"
                            >
                              <input
                                type="hidden"
                                name="intent"
                                value="resolve_linkedin_attempt"
                              />
                              <input
                                type="hidden"
                                name="draft_id"
                                value={draft.id}
                              />
                              <input
                                name="requested_by"
                                placeholder="Verifier name"
                                required
                              />
                              <input
                                name="resolution_note"
                                placeholder="How you confirmed no post exists"
                                required
                              />
                              <button
                                type="submit"
                                className="secondary"
                                disabled={isSubmitting}
                              >
                                Confirm no post was created
                              </button>
                            </Form>
                          ) : null}
                        </section>

                        <Form
                          method="post"
                          className="publish-form"
                        >
                        <input
                          type="hidden"
                          name="intent"
                          value="update_content_status"
                        />
                        <input
                          type="hidden"
                          name="draft_id"
                          value={draft.id}
                        />
                        <input
                          type="hidden"
                          name="next_status"
                          value="published"
                        />

                        <input
                          type="text"
                          name="reviewer_name"
                          placeholder="Publisher name"
                          defaultValue="Adam Copenhaver"
                          required
                        />

                        <input
                          type="text"
                          name="review_note"
                          placeholder="Optional publication note"
                        />

                        <input
                          type="url"
                          name="linkedin_post_url"
                          placeholder="Published LinkedIn URL"
                          required
                        />

                        <button
                          type="submit"
                          disabled={isSubmitting}
                        >
                          {isSubmitting
                            ? "Saving..."
                            : "Mark published"}
                        </button>
                        </Form>
                      </div>
                    ) : null}

                    {draft.status === "published" &&
                    draft.linkedin_post_url ? (
                      <a
                        className="published-link"
                        href={draft.linkedin_post_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open published post ↗
                      </a>
                    ) : null}

                    <div className="review-history">
                      <strong>Review history</strong>

                      {reviewHistory.filter(
                        (item) =>
                          item.content_draft_id === draft.id,
                      ).length === 0 ? (
                        <p className="review-history-empty">
                          No review actions recorded yet.
                        </p>
                      ) : (
                        reviewHistory
                          .filter(
                            (item) =>
                              item.content_draft_id === draft.id,
                          )
                          .map((item) => (
                            <div
                              className="review-history-row"
                              key={item.id}
                            >
                              <div>
                                <strong>
                                  {item.from_status || "created"} →{" "}
                                  {item.to_status}
                                </strong>
                                <span>
                                  {item.reviewer_name ||
                                    "Unknown reviewer"}
                                </span>
                              </div>

                              {item.review_note ? (
                                <p>{item.review_note}</p>
                              ) : null}

                              <time>{item.created_at}</time>
                            </div>
                          ))
                      )}
                    </div>
                  </details>
                ))
              )}
            </div>
          </div>
        </section>

        <details className="panel dashboard-section" id="activity">
          <summary className="panel-heading">
            <div>
              <p className="eyebrow">ACTIVITY HISTORY</p>
              <h2>Recent employee activity</h2>
            </div>

            <span className="activity-count">
              {recentActivities.length} recent events
            </span>
          </summary>

          {recentActivities.length === 0 ? (
            <div className="empty-state">
              <strong>No activity has been logged yet.</strong>
              <p>
                Completed posts, comments, connections, conversations,
                and lead handoffs will appear here.
              </p>
            </div>
          ) : (
            <div className="activity-feed">
              {recentActivities.map((activity) => {
                const labels: Record<string, string> = {
                  original_post: "Original post",
                  short_post: "Short post",
                  meaningful_comment: "Meaningful comment",
                  relevant_connection: "Relevant connection",
                  qualified_conversation: "Qualified conversation",
                  lead_handoff: "Lead handed off",
                };

                const activityLabel =
                  labels[activity.event_type] ?? activity.event_type;

                const activityDate = new Date(
                  activity.occurred_at.replace(" ", "T") + "Z",
                );

                return (
                  <article className="activity-feed-row" key={activity.id}>
                    <div className="activity-icon">
                      {activity.employee_name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </div>

                    <div className="activity-feed-content">
                      <div className="activity-feed-title">
                        <strong>{activity.employee_name}</strong>
                        <span>{activityLabel}</span>
                      </div>

                      <p>
                        {activity.description ||
                          `${activityLabel} logged without a description.`}
                      </p>

                      <div className="activity-feed-meta">
                        <span>
                          {activityDate.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>

                        <span className="activity-source">
                          Source: {activity.source}
                        </span>

                        {activity.content_url ? (
                          <a
                            href={activity.content_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open LinkedIn activity ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </details>

        <details className="panel dashboard-section" id="agents">
          <summary className="panel-heading">
            <div>
              <p className="eyebrow">AI WORKFORCE</p>
              <h2>LinkedInAdam agents</h2>
            </div>
          </summary>

          <div className="agent-grid">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.name}>
                <strong>{agent.name}</strong>
                <p>{agent.description}</p>
                <span>Human approval required</span>
              </article>
            ))}
          </div>
        </details>
      </section>
    </main>
  );
}
