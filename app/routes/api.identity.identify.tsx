import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { IdentityEngine } from "../services/identityEngine.server";
import { WebhookDispatcher } from "../services/webhookDispatcher.server";

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
  return json({ status: "API Identify Endpoint Ready" }, { headers: CORS_HEADERS });
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
        },
      });
    }

    const body = await request.json();
    const { visitor_id, type, value, source, confidence_score, metadata } = body;

    const result = await IdentityEngine.identify({
      shopId: shop.id,
      visitorId: visitor_id,
      type,
      rawValue: value,
      source: source || "user_submitted",
      confidenceScore: confidence_score ?? 100,
      metadata,
    });

    // Background webhook trigger for identity resolution
    WebhookDispatcher.dispatch(shop.id, "identity_resolved", {
      event: "identity_resolved",
      shopDomain,
      visitorId: visitor_id,
      status: "identified",
      intentScore: 80,
      intentTier: "high",
      timestamp: new Date().toISOString(),
      customer: {
        email: type === "email" ? value : undefined,
        phone: type === "phone" ? value : undefined,
      },
    }).catch(() => {});

    return json(
      {
        message: "Identity resolved successfully",
        ...result,
      },
      {
        headers: CORS_HEADERS,
      }
    );
  } catch (error: any) {
    console.error("Error in api.identity.identify:", error);
    return json({ success: false, error: error.message }, { status: 400, headers: CORS_HEADERS });
  }
};
