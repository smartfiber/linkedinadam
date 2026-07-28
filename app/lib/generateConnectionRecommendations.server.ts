import OpenAI from "openai";

export type ProspectForRecommendation = {
  id: number;
  name: string;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  sourceContext: string | null;
};

export type EmployeePlaybookForRecommendation = {
  employeeId: number;
  employeeName: string;
  playbookId: number;
  roleName: string;
  primaryAudience: string | null;
  secondaryAudience: string | null;
  primaryExpertise: string | null;
  qualifiedBuyingSignal: string | null;
  guardrail: string | null;
};

type GeneratedRecommendation = {
  prospect_id: number;
  employee_id: number;
  playbook_id: number;
  score: number;
  relevance_reason: string;
  suggested_note: string;
};

export async function generateConnectionRecommendations(input: {
  apiKey: string;
  prospects: ProspectForRecommendation[];
  assignments: EmployeePlaybookForRecommendation[];
  sourceName: string;
  sourceType: string;
  sourceText: string | null;
}) {
  const client = new OpenAI({ apiKey: input.apiKey });

  const response = await client.responses.create({
    model: "gpt-5-mini",
    store: false,
    instructions: `
Match each imported prospect to exactly one employee and that employee's assigned playbook.
Use only the supplied prospect, source, employee, and playbook data.
Score relevance from 0 to 100.
Prefer audience fit, expertise fit, source context, and explicit buying signals.
Do not infer sensitive traits or invent facts.
Write a concise factual rationale.
Write a natural invitation note no longer than 250 characters.
The note must not claim a prior relationship, mention surveillance, or use aggressive sales language.
Return one result for every prospect.
    `.trim(),
    input: JSON.stringify({
      source: {
        name: input.sourceName,
        type: input.sourceType,
        pasted_text: input.sourceText,
      },
      prospects: input.prospects,
      available_employee_playbooks: input.assignments,
    }),
    text: {
      format: {
        type: "json_schema",
        name: "connection_recommendations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            recommendations: {
              type: "array",
              minItems: input.prospects.length,
              maxItems: input.prospects.length,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  prospect_id: { type: "integer" },
                  employee_id: { type: "integer" },
                  playbook_id: { type: "integer" },
                  score: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                  },
                  relevance_reason: { type: "string" },
                  suggested_note: { type: "string" },
                },
                required: [
                  "prospect_id",
                  "employee_id",
                  "playbook_id",
                  "score",
                  "relevance_reason",
                  "suggested_note",
                ],
              },
            },
          },
          required: ["recommendations"],
        },
      },
    },
  });

  if (!response.output_text.trim()) {
    throw new Error("OpenAI returned an empty recommendation set.");
  }

  const parsed = JSON.parse(response.output_text) as {
    recommendations?: GeneratedRecommendation[];
  };

  if (
    !Array.isArray(parsed.recommendations) ||
    parsed.recommendations.length !== input.prospects.length
  ) {
    throw new Error(
      "OpenAI returned an incomplete recommendation set.",
    );
  }

  const prospectIds = new Set(
    input.prospects.map((prospect) => prospect.id),
  );
  const assignments = new Map(
    input.assignments.map((assignment) => [
      `${assignment.employeeId}:${assignment.playbookId}`,
      assignment,
    ]),
  );
  const returnedProspects = new Set<number>();

  for (const recommendation of parsed.recommendations) {
    if (
      !prospectIds.has(recommendation.prospect_id) ||
      returnedProspects.has(recommendation.prospect_id)
    ) {
      throw new Error(
        "OpenAI returned invalid or duplicate prospect assignments.",
      );
    }

    if (
      !assignments.has(
        `${recommendation.employee_id}:${recommendation.playbook_id}`,
      )
    ) {
      throw new Error(
        "OpenAI returned an employee and playbook mismatch.",
      );
    }

    if (
      !Number.isInteger(recommendation.score) ||
      recommendation.score < 0 ||
      recommendation.score > 100
    ) {
      throw new Error("OpenAI returned an invalid relevance score.");
    }

    recommendation.relevance_reason =
      recommendation.relevance_reason.trim();
    recommendation.suggested_note =
      recommendation.suggested_note.trim().slice(0, 250);

    if (
      !recommendation.relevance_reason ||
      !recommendation.suggested_note
    ) {
      throw new Error(
        "OpenAI returned an incomplete recommendation.",
      );
    }

    returnedProspects.add(recommendation.prospect_id);
  }

  return parsed.recommendations;
}
