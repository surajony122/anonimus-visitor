import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { processVisitorIntentAndTriggers } from "../services/intentEngine.server";
import { IdentityEngine } from "../services/identityEngine.server";
import { appCache } from "../services/cache.server";

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
    const rawHeaderDomain = request.headers.get("x-shopify-shop-domain") || "";
    const cleanDomain = rawHeaderDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase().trim();
    const handle = cleanDomain.split(".")[0] || "theunniyarcha";
    const shopDomain = cleanDomain || `${handle}.myshopify.com`;

    let shop = await prisma.shop.findFirst({
      where: {
        OR: [
          { shopDomain: cleanDomain },
          { shopDomain: `${handle}.myshopify.com` },
          { shopDomain: { startsWith: handle } },
          { shopDomain: { contains: handle } },
        ],
      },
    });

    if (!shop) {
      shop = await prisma.shop.findFirst({
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          shopDomain: `${handle}.myshopify.com`,
          shopifyShopId: `gid://shopify/Shop/${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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
      device,
      email,
      phone,
      login_id,
    } = body;

    if (!visitor_id || !event_type) {
      return json({ error: "Missing visitor_id or event_type" }, { status: 400, headers: CORS_HEADERS });
    }

    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();

    // Determine device & browser characteristics
    const deviceCategory = device?.deviceCategory || metadata?.deviceCategory || (device?.isMobile ? "mobile" : "desktop");
    const clientMeta = {
      browser: device?.browser || metadata?.browser || "Unknown Browser",
      browserVersion: device?.browserVersion || metadata?.browserVersion || "",
      os: device?.os || metadata?.os || "Unknown OS",
      screenResolution: device?.screenResolution || metadata?.screenResolution || "",
      language: device?.language || metadata?.language || "en",
      timezone: device?.timezone || metadata?.timezone || "UTC",
      storageAvailable: device?.storageAvailable || true,
      lastLoginId: login_id || metadata?.loginId || null,
    };

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
          deviceCategory: deviceCategory || "desktop",
          metadata: JSON.stringify(clientMeta),
        },
      });
    } else {
      let existingMeta = {};
      try {
        if (visitor.metadata) existingMeta = JSON.parse(visitor.metadata);
      } catch {}
      const mergedMeta = { ...existingMeta, ...clientMeta };

      await prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          lastSeenAt: eventTimestamp,
          deviceCategory: deviceCategory || visitor.deviceCategory || "desktop",
          metadata: JSON.stringify(mergedMeta),
        },
      });
    }

    // Auto-stitch identity if email, phone, or login_id are attached to this event
    const emailToIdentify = email || metadata?.email || metadata?.context?.email;
    const phoneToIdentify = phone || metadata?.phone || metadata?.context?.phone;

    if (emailToIdentify && emailToIdentify.includes("@")) {
      IdentityEngine.identify({
        shopId,
        visitorId: visitor_id,
        type: "email",
        rawValue: emailToIdentify,
        source: metadata?.identity_source || "storefront_autofill",
      }).catch((e) => console.warn("Auto-identity email error:", e.message));
    }

    if (phoneToIdentify && phoneToIdentify.length >= 7) {
      IdentityEngine.identify({
        shopId,
        visitorId: visitor_id,
        type: "phone",
        rawValue: phoneToIdentify,
        source: metadata?.identity_source || "storefront_autofill",
      }).catch((e) => console.warn("Auto-identity phone error:", e.message));
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

    // Invalidate stale aggregate cache
    appCache.invalidate("funnel_data_");

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
