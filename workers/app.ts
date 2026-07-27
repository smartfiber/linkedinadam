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

      const image = await env.LINKEDIN_IMAGES.get(key);

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
        "public, max-age=3600, stale-while-revalidate=86400",
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
