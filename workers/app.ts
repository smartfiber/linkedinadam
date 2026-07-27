import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const imagePrefix = "/images/generated/";

    if (
      request.method === "GET" &&
      url.pathname.startsWith(imagePrefix)
    ) {
      const key = decodeURIComponent(
        url.pathname.slice(imagePrefix.length),
      );

      if (!key || key.includes("..")) {
        return new Response("Invalid image key.", {
          status: 400,
        });
      }

      let image: R2ObjectBody | null;

      try {
        image = await env.LINKEDIN_IMAGES.get(key);
      } catch (error) {
        console.error("Generated image lookup failed.", error);

        return new Response("Image storage is temporarily unavailable.", {
          status: 503,
        });
      }

      if (!image || !("body" in image)) {
        return new Response("Image not found.", {
          status: 404,
        });
      }

      const headers = new Headers();

      image.writeHttpMetadata(headers);
      headers.set("etag", image.httpEtag);
      headers.set(
        "cache-control",
        "private, max-age=3600",
      );
      headers.set("x-content-type-options", "nosniff");

      return new Response(image.body, {
        headers,
      });
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
