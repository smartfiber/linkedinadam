import { createRequestHandler } from "react-router";
import { runAutopilotCycle } from "../app/lib/autopilot.server";
import {
  getAuthenticatedUser,
  type AccessEnvironment,
} from "../app/lib/auth.server";

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

    // Cloudflare Access is the external policy boundary. Keep the OAuth
    // callback public so LinkedIn can complete its redirect; the callback
    // validates its one-time state before linking an account.
    if (url.pathname !== "/auth/linkedin/callback") {
      const user = getAuthenticatedUser(
        request,
        env as unknown as AccessEnvironment,
      );
      if (!user) {
        return new Response("Cloudflare Access authentication required.", {
          status: 401,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "www-authenticate": "Cloudflare Access",
          },
        });
      }
    }

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
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runAutopilotCycle(env));
  },
} satisfies ExportedHandler<Env>;
