import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { processVisitorIntentAndTriggers } from "../services/intentEngine.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-shopify-shop-domain, Authorization",
  "Access-Control-Max-Age": "86400",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  return json({ status: "API Events Endpoint Ready" }, { headers: CORS_HEADERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  try {
    const shopDomain =
      request.headers.get("x-shopify-shop-domain") || "ravistore-shop.myshopify.com";

    let shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          shopDomain,
          shopifyShopId: "gid://shopify/Shop/1234567890",
          installedAt: new Date(),
          privacySettings: {
            create: {
              retentionDays: 90,
              trackingEnabled: true,
              analyticsEnabled: true,
            },
          },
        },
      });
    }

    const shopId = shop.id;
    const body = await request.json();
    const {
      visitor_id,
      session_id,
      event_type,
      timestamp,
      page_url,
      product_id,
      variant_id,
      collection_id,
      cart_id,
      metadata,
    } = body;

    if (!visitor_id || !event_type) {
      return json({ error: "Missing visitor_id or event_type" }, { status: 400, headers: CORS_HEADERS });
    }

    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();

    let visitor = await prisma.visitor.findUnique({
      where: {
        shopId_visitorId: { shopId, visitorId: visitor_id },
      },
    });

    if (!visitor) {
      visitor = await prisma.visitor.create({
        data: {
          shopId,
          visitorId: visitor_id,
          status: "anonymous",
          firstSeenAt: eventTimestamp,
          lastSeenAt: eventTimestamp,
          deviceCategory: "desktop",
        },
      });
    } else {
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: eventTimestamp },
      });
    }

    const event = await prisma.event.create({
      data: {
        shopId,
        visitorId: visitor_id,
        eventType: event_type,
        timestamp: eventTimestamp,
        pageUrl: page_url,
        productId: product_id,
        variantId: variant_id,
        collectionId: collection_id,
        cartId: cart_id,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // Background intent evaluation and webhook trigger dispatching
    processVisitorIntentAndTriggers(shopId, visitor_id, shopDomain).catch(() => {});

    return json(
      {
        success: true,
        event_id: event.eventId,
        visitor_id: visitor.visitorId,
        status: visitor.status,
      },
      {
        headers: CORS_HEADERS,
      }
    );
  } catch (error: any) {
    console.error("Error in api.events:", error);
    return json({ error: "Internal Server Error", details: error.message }, { status: 500, headers: CORS_HEADERS });
  }
};
