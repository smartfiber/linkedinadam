import { LinkedInAPIError } from "./linkedinErrors.server";

const LINKEDIN_VERSION = "202606";

function apiHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "linkedin-version": LINKEDIN_VERSION,
    "x-restli-protocol-version": "2.0.0",
  };
}

async function initializeImage(
  accessToken: string,
  personUrn: string,
) {
  let response: Response;

  try {
    response = await fetch(
      "https://api.linkedin.com/rest/images?action=initializeUpload",
      {
        method: "POST",
        headers: apiHeaders(accessToken),
        body: JSON.stringify({
          initializeUploadRequest: { owner: personUrn },
        }),
      },
    );
  } catch {
    throw new LinkedInAPIError(
      "LinkedIn image initialization failed.",
      { code: "image_connection" },
    );
  }

  if (!response.ok) {
    throw new LinkedInAPIError(
      "LinkedIn image initialization was rejected.",
      {
        status: response.status,
        code: "image_rejected",
      },
    );
  }

  const data = (await response.json()) as {
    value?: { uploadUrl?: string; image?: string };
  };

  if (!data.value?.uploadUrl || !data.value.image) {
    throw new LinkedInAPIError(
      "LinkedIn returned incomplete image upload details.",
      { code: "image_invalid_response" },
    );
  }

  return {
    uploadUrl: data.value.uploadUrl,
    imageUrn: data.value.image,
  };
}

async function uploadImage(
  uploadUrl: string,
  image: ArrayBuffer,
  mimeType: string,
) {
  let response: Response;

  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: image,
    });
  } catch {
    throw new LinkedInAPIError(
      "LinkedIn image upload failed.",
      { code: "image_connection" },
    );
  }

  if (!response.ok) {
    throw new LinkedInAPIError(
      "LinkedIn rejected the image upload.",
      {
        status: response.status,
        code: "image_rejected",
      },
    );
  }
}

export async function publishLinkedInPost(input: {
  accessToken: string;
  personUrn: string;
  commentary: string;
  image?: {
    bytes: ArrayBuffer;
    mimeType: string;
    altText: string;
  };
}) {
  let imageUrn: string | null = null;

  if (input.image) {
    const initialized = await initializeImage(
      input.accessToken,
      input.personUrn,
    );
    imageUrn = initialized.imageUrn;
    await uploadImage(
      initialized.uploadUrl,
      input.image.bytes,
      input.image.mimeType,
    );
  }

  const payload: Record<string, unknown> = {
    author: input.personUrn,
    commentary: input.commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageUrn && input.image) {
    payload.content = {
      media: {
        id: imageUrn,
        altText: input.image.altText,
      },
    };
  }

  let response: Response;

  try {
    response = await fetch(
      "https://api.linkedin.com/rest/posts",
      {
        method: "POST",
        headers: apiHeaders(input.accessToken),
        body: JSON.stringify(payload),
      },
    );
  } catch {
    throw new LinkedInAPIError(
      "LinkedIn post confirmation was interrupted.",
      {
        code: "post_connection",
        uncertain: true,
      },
    );
  }

  if (!response.ok) {
    throw new LinkedInAPIError(
      "LinkedIn rejected the post.",
      {
        status: response.status,
        code: "post_rejected",
      },
    );
  }

  const postUrn = response.headers.get("x-restli-id");

  if (!postUrn) {
    throw new LinkedInAPIError(
      "LinkedIn did not return a post identifier.",
      {
        code: "post_missing_id",
        uncertain: true,
      },
    );
  }

  return {
    imageUrn,
    postUrn,
    postUrl:
      `https://www.linkedin.com/feed/update/${postUrn}/`,
  };
}
