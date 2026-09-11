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

  // Guarantee frame-ancestors is allowed for Shopify Admin iframe embedding
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  let frameAncestors = "https://*.myshopify.com https://admin.shopify.com";
  if (shop) {
    frameAncestors += ` https://${shop}`;
  }

  // Remove X-Frame-Options so it doesn't collide with CSP frame-ancestors
  responseHeaders.delete("X-Frame-Options");
  responseHeaders.delete("x-frame-options");

  const existingCsp = responseHeaders.get("Content-Security-Policy");
  if (!existingCsp || !existingCsp.includes("frame-ancestors")) {
    responseHeaders.set(
      "Content-Security-Policy",
      `frame-ancestors ${frameAncestors};`
    );
  }

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
