import OpenAI from "openai";
import {
  PLANNER_MODEL,
  type GeneratedPlanItem,
} from "./contentPlanner";

type GenerateWeeklyContentPlanInput = {
  apiKey: string;
  employeeName: string;
  roleName: string;
  weekStart: string;
  originalPostTarget: number;
  shortPostTarget: number;
  primaryAudience: string | null;
  primaryExpertise: string | null;
  positioningStatement: string | null;
  recurringSeries: string | null;
  softCta: string | null;
  guardrail: string | null;
  recentTopics: string[];
  occupiedTimes: string[];
  analyticsInsights: string[];
  planningInstructions: string | null;
};

export async function generateWeeklyContentPlan(
  input: GenerateWeeklyContentPlanInput,
) {
  const client = new OpenAI({ apiKey: input.apiKey });
  const totalPosts =
    input.originalPostTarget + input.shortPostTarget;
  const response = await client.responses.create({
    model: PLANNER_MODEL,
    store: false,
    instructions: `
Create a practical weekly LinkedIn content plan for one employee.
Return planning concepts, not finished post copy.
Never invent customer stories, statistics, company results, or market facts.
Respect the exact requested format counts and selected week.
Use distinct topics and avoid the supplied recent topics.
Use local wall-clock timestamps in America/Chicago in YYYY-MM-DDTHH:mm format.
Prefer normal weekday working hours and avoid occupied times.
    `.trim(),
    input: `
Employee: ${input.employeeName}
Role: ${input.roleName}
Week starts Monday: ${input.weekStart}
Required original posts: ${input.originalPostTarget}
Required short posts: ${input.shortPostTarget}
Total items required: ${totalPosts}

Audience: ${input.primaryAudience || "Not specified"}
Expertise: ${input.primaryExpertise || "Not specified"}
Positioning: ${input.positioningStatement || "Not specified"}
Recurring series: ${input.recurringSeries || "Not specified"}
Soft CTA: ${input.softCta || "Not specified"}
Guardrail: ${input.guardrail || "Avoid unsupported claims."}

Recent topics to avoid:
${input.recentTopics.length ? input.recentTopics.join("\n") : "None"}

Occupied times:
${input.occupiedTimes.length ? input.occupiedTimes.join("\n") : "None"}

Evidence-backed analytics context:
${input.analyticsInsights.join("\n")}

Additional planning instructions:
${input.planningInstructions || "None"}
    `.trim(),
    text: {
      format: {
        type: "json_schema",
        name: "weekly_content_plan",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            items: {
              type: "array",
              minItems: totalPosts,
              maxItems: totalPosts,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  post_format: {
                    type: "string",
                    enum: ["original_post", "short_post"],
                  },
                  topic: { type: "string" },
                  angle: { type: "string" },
                  rationale: { type: "string" },
                  suggested_scheduled_for: { type: "string" },
                },
                required: [
                  "post_format",
                  "topic",
                  "angle",
                  "rationale",
                  "suggested_scheduled_for",
                ],
              },
            },
          },
          required: ["items"],
        },
      },
    },
  });

  if (!response.output_text.trim()) {
    throw new Error("OpenAI returned an empty content plan.");
  }

  const parsed = JSON.parse(response.output_text) as {
    items?: GeneratedPlanItem[];
  };

  if (!Array.isArray(parsed.items)) {
    throw new Error("OpenAI returned an invalid content plan.");
  }

  return {
    items: parsed.items,
    model: PLANNER_MODEL,
  };
}
