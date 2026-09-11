import { PassThrough } from "stream";
import type { AppLoadContext, EntryContext } from "@remix-run/node";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { addDocumentResponseHeaders } from "./shopify.server";

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext
) {
  addDocumentResponseHeaders(request, responseHeaders);

  // Forcefully ensure frame-ancestors allows Shopify Admin embedding
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const allowedAncestors = `https://*.myshopify.com https://admin.shopify.com ${shop ? `https://${shop}` : ""}`.trim();
  const frameAncestorsDirective = `frame-ancestors ${allowedAncestors};`;

  // Remove X-Frame-Options to prevent any legacy header conflicts
  responseHeaders.delete("X-Frame-Options");
  responseHeaders.delete("x-frame-options");

  let csp = responseHeaders.get("Content-Security-Policy") || "";
  if (csp.includes("frame-ancestors")) {
    csp = csp.replace(/frame-ancestors[^;]+;?/g, frameAncestorsDirective);
  } else {
    csp = `${csp ? `${csp} ` : ""}${frameAncestorsDirective}`;
  }
  responseHeaders.set("Content-Security-Policy", csp);

  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    let didError = false;

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: didError ? 500 : responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          didError = true;
          console.error(error);
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
