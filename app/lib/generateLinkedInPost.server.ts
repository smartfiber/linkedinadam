import OpenAI from "openai";

type GenerateLinkedInPostInput = {
  apiKey: string;
  employeeName: string;
  roleName: string;
  topic: string;
  postFormat: "original_post" | "short_post";
  primaryAudience: string | null;
  primaryExpertise: string | null;
  positioningStatement: string | null;
  recurringSeries: string | null;
  leadMagnet: string | null;
  softCta: string | null;
  guardrail: string | null;
  writingStylePrompt: string | null;
};

export async function generateLinkedInPost(
  input: GenerateLinkedInPostInput,
) {
  const client = new OpenAI({
    apiKey: input.apiKey,
  });

  const lengthInstruction =
    input.postFormat === "short_post"
      ? "Write a concise LinkedIn post of approximately 60 to 120 words."
      : "Write a substantial LinkedIn post of approximately 180 to 300 words.";

  const response = await client.responses.create({
    model: "gpt-5-mini",
    store: false,
    instructions: `
You write credible LinkedIn content for technology and telecom professionals.

The post must:
- Sound like the named employee, not a generic company account.
- Be useful and specific.
- Avoid invented statistics, customer claims, or unsupported market claims.
- Avoid excessive hashtags, emojis, hype, and sales language.
- Use short paragraphs suitable for LinkedIn.
- End with a natural conversation prompt or the supplied soft CTA.
- Return only the finished post copy.
    `.trim(),
    input: `
Employee: ${input.employeeName}
Role: ${input.roleName}
Requested topic: ${input.topic}
Format: ${input.postFormat}

Primary audience:
${input.primaryAudience || "Not specified"}

Primary expertise:
${input.primaryExpertise || "Not specified"}

Positioning:
${input.positioningStatement || "Not specified"}

Recurring content series:
${input.recurringSeries || "Not specified"}

Lead magnet:
${input.leadMagnet || "None"}

Soft CTA:
${input.softCta || "End with a thoughtful question."}

Guardrail:
${input.guardrail || "Do not make unsupported claims."}

Employee-specific writing style:
${input.writingStylePrompt || "Use a clear, credible, conversational professional voice."}

Writing requirement:
${lengthInstruction}
    `.trim(),
  });

  const post = response.output_text.trim();

  if (!post) {
    throw new Error("OpenAI returned an empty draft.");
  }

  return post;
}
