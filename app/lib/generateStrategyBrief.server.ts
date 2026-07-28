import OpenAI from "openai";

export type StrategyBrief = {
  campaign_objective: string;
  audience_priority: string;
  buyer_problem: string;
  point_of_view: string;
  content_pillars: string[];
  evidence_boundaries: string[];
  prohibited_claims: string[];
  format_guidance: string;
  cta_strategy: string;
  writing_style: string;
  success_criteria: string[];
};

export async function generateStrategyBrief(input: {
  apiKey: string;
  employeeName: string;
  roleName: string;
  weekStart: string;
  playbookSnapshot: Record<string, unknown>;
  instructions: string | null;
}) {
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = await client.responses.create({
    model: "gpt-5-mini",
    store: false,
    instructions: `
Act as the Strategy Agent for an employee LinkedIn program.
Create a concrete weekly strategy brief for the downstream Content Planner.
Use only the supplied employee and playbook facts.
Never invent customer proof, market statistics, credentials, or experience.
Make evidence boundaries and prohibited claims explicit.
    `.trim(),
    input: JSON.stringify(input),
    text: {
      format: {
        type: "json_schema",
        name: "strategy_brief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            campaign_objective: { type: "string" },
            audience_priority: { type: "string" },
            buyer_problem: { type: "string" },
            point_of_view: { type: "string" },
            content_pillars: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              items: { type: "string" },
            },
            evidence_boundaries: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string" },
            },
            prohibited_claims: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string" },
            },
            format_guidance: { type: "string" },
            cta_strategy: { type: "string" },
            writing_style: { type: "string" },
            success_criteria: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "string" },
            },
          },
          required: [
            "campaign_objective","audience_priority","buyer_problem",
            "point_of_view","content_pillars","evidence_boundaries",
            "prohibited_claims","format_guidance","cta_strategy",
            "writing_style","success_criteria"
          ],
        },
      },
    },
  });
  const text = response.output_text.trim();
  if (!text) throw new Error("OpenAI returned an empty strategy brief.");
  return JSON.parse(text) as StrategyBrief;
}
