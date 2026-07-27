import OpenAI from "openai";

type ImageStyle =
  | "editorial"
  | "branded"
  | "photorealistic"
  | "diagram";

type GenerateLinkedInImageInput = {
  apiKey: string;
  employeeName: string;
  roleName: string;
  topic: string | null;
  postBody: string;
  style: ImageStyle;
  customInstructions: string | null;
};

export async function generateLinkedInImage(
  input: GenerateLinkedInImageInput,
) {
  const client = new OpenAI({
    apiKey: input.apiKey,
  });

  const styleInstructions: Record<ImageStyle, string> = {
    editorial:
      "Create a sophisticated editorial technology illustration with strong visual hierarchy, restrained detail, and a premium business-publication feel.",
    branded:
      "Create a polished B2B technology campaign graphic with clean geometric forms, modern network imagery, and space for the composition to breathe.",
    photorealistic:
      "Create a credible photorealistic business technology scene. Avoid staged stock-photo poses, fake interfaces, and visible brand logos.",
    diagram:
      "Create a visually compelling conceptual diagram using simple shapes, clear relationships, and minimal or no written text.",
  };

  const prompt = `
Create a professional landscape image to accompany a LinkedIn post.

Employee:
${input.employeeName}

Role:
${input.roleName}

Topic:
${input.topic || "Technology and telecom leadership"}

Post:
${input.postBody}

Visual direction:
${styleInstructions[input.style]}

Additional instructions:
${input.customInstructions || "None"}

Requirements:
- Landscape composition suitable for a LinkedIn post.
- Do not include LinkedIn logos or third-party trademarks.
- Do not place long paragraphs, statistics, or invented claims in the image.
- Avoid generic handshakes, call-centre headsets, glowing robots, and cliché stock imagery.
- Make the concept understandable without relying on written text.
- Produce one finished image.
  `.trim();

  const response = await client.images.generate({
    model: "gpt-image-1-mini",
    prompt,
    size: "1536x1024",
    quality: "low",
    output_format: "png",
  });

  const base64Image = response.data?.[0]?.b64_json;

  if (!base64Image) {
    throw new Error("OpenAI returned no image data.");
  }

  const binary = Uint8Array.from(
    atob(base64Image),
    (character) => character.charCodeAt(0),
  );

  return {
    bytes: binary,
    prompt,
    mimeType: "image/png",
  };
}
