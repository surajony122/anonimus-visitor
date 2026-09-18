import prisma from "../db.server";
import { WebhookDispatcher } from "./webhookDispatcher.server";

export interface IntentSignals {
  pageViewsCount: number;
  productViewsCount: number;
  uniqueProductIds: Set<string> | string[];
  repeatProductViews: number;
  collectionViewsCount: number;
  searchesCount: number;
  addedToCartCount: number;
  cartViewedCount: number;
  cartValue: number;
  checkoutStartedCount: number;
  checkoutCompletedCount: number;
  sessionDurationMinutes: number;
  sessionsCount: number;
}

export interface IntentScoreResult {
  score: number;
  tier: "low" | "medium" | "high" | "very_high";
  breakdown: {
    productEngagement: number;
    cartActivity: number;
    checkoutProgress: number;
    sessionDepth: number;
  };
}

export interface IntentConfig {
  productViewWeight: number;
  repeatProductViewWeight: number;
  collectionViewWeight: number;
  searchWeight: number;
  addToCartWeight: number;
  cartViewWeight: number;
  highCartValueBonus: number;
  checkoutStartedWeight: number;
  checkoutCompletedWeight: number;
  sessionDepthWeight: number;
  highIntentThreshold: number;
  veryHighIntentThreshold: number;
}

export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  productViewWeight: 5,
  repeatProductViewWeight: 10,
  collectionViewWeight: 2,
  searchWeight: 4,
  addToCartWeight: 25,
  cartViewWeight: 15,
  highCartValueBonus: 15,
  checkoutStartedWeight: 30,
  checkoutCompletedWeight: 50,
  sessionDepthWeight: 10,
  highIntentThreshold: 61,
  veryHighIntentThreshold: 81,
};

export function calculateIntentScore(
  signals: Partial<IntentSignals>,
  config: IntentConfig = DEFAULT_INTENT_CONFIG
): IntentScoreResult {
  const pViews = signals.productViewsCount || 0;
  const repeatViews = signals.repeatProductViews || 0;
  const cViews = signals.collectionViewsCount || 0;
  const searches = signals.searchesCount || 0;
  const addToCart = signals.addedToCartCount || 0;
  const cartViews = signals.cartViewedCount || 0;
  const cartVal = signals.cartValue || 0;
  const checkoutsStarted = signals.checkoutStartedCount || 0;
  const checkoutsCompleted = signals.checkoutCompletedCount || 0;
  const duration = signals.sessionDurationMinutes || 0;
  const sessions = signals.sessionsCount || 1;

  let productEngagement =
    pViews * (config.productViewWeight ?? 5) +
    repeatViews * (config.repeatProductViewWeight ?? 10) +
    cViews * (config.collectionViewWeight ?? 2) +
    searches * (config.searchWeight ?? 4);
  productEngagement = Math.min(35, productEngagement);

  let cartActivity =
    addToCart * (config.addToCartWeight ?? 25) +
    cartViews * (config.cartViewWeight ?? 15) +
    (cartVal >= 100 ? (config.highCartValueBonus ?? 15) : 0);
  cartActivity = Math.min(35, cartActivity);

  let checkoutProgress =
    checkoutsStarted * (config.checkoutStartedWeight ?? 30) +
    checkoutsCompleted * (config.checkoutCompletedWeight ?? 50);
  checkoutProgress = Math.min(40, checkoutProgress);

  let sessionDepth = (duration > 3 ? (config.sessionDepthWeight ?? 10) : 0) + (sessions > 1 ? 5 : 0);
  sessionDepth = Math.min(15, sessionDepth);

  const rawScore = productEngagement + cartActivity + checkoutProgress + sessionDepth;
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  const highThreshold = config.highIntentThreshold ?? 61;
  const veryHighThreshold = config.veryHighIntentThreshold ?? 81;

  let tier: "low" | "medium" | "high" | "very_high" = "low";
  if (finalScore >= veryHighThreshold) {
    tier = "very_high";
  } else if (finalScore >= highThreshold) {
    tier = "high";
  } else if (finalScore >= 31) {
    tier = "medium";
  } else {
    tier = "low";
  }

  return {
    score: finalScore,
    tier,
    breakdown: {
      productEngagement,
      cartActivity,
      checkoutProgress,
      sessionDepth,
    },
  };
}

export async function processVisitorIntentAndTriggers(shopId: string, visitorId: string, shopDomain: string) {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        visitors: {
          where: { visitorId },
          include: {
            events: { orderBy: { timestamp: "desc" }, take: 50 },
            customerLinks: { include: { customer: true } },
            identities: true,
          },
        },
      },
    });

    if (!shop || !shop.visitors[0]) return;

    const visitor = shop.visitors[0];
    const events = visitor.events;

    let config = DEFAULT_INTENT_CONFIG;
    if (shop.settings) {
      try {
        const parsed = JSON.parse(shop.settings);
        if (parsed.intentConfig) config = { ...DEFAULT_INTENT_CONFIG, ...parsed.intentConfig };
      } catch {}
    }

    const pViews = events.filter((e) => e.eventType === "product_viewed").length;
    const uniqueProductIds = new Set(
      events.filter((e) => e.eventType === "product_viewed" && e.productId).map((e) => e.productId!)
    );
    const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
    const cViews = events.filter((e) => e.eventType === "collection_viewed").length;
    const searches = events.filter((e) => e.eventType === "search_submitted").length;
    const addToCart = events.filter((e) => e.eventType === "product_added_to_cart").length;
    const cartViews = events.filter((e) => e.eventType === "cart_viewed").length;
    const checkouts = events.filter((e) => e.eventType === "checkout_started").length;
    const checkoutsCompleted = events.filter((e) => e.eventType === "checkout_completed").length;

    let cartVal = 0;
    events.forEach((e) => {
      if (e.metadata) {
        try {
          const meta = JSON.parse(e.metadata);
          if (meta.cartValue || meta.price) cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
        } catch {}
      }
    });

    const intent = calculateIntentScore(
      {
        productViewsCount: pViews,
        repeatProductViews: repeatViews,
        collectionViewsCount: cViews,
        searchesCount: searches,
        addedToCartCount: addToCart,
        cartViewedCount: cartViews,
        cartValue: cartVal,
        checkoutStartedCount: checkouts,
        checkoutCompletedCount: checkoutsCompleted,
      },
      config
    );

    // If intent is High or Very High, trigger outbound webhook
    if (intent.tier === "high" || intent.tier === "very_high") {
      const customer = visitor.customerLinks[0]?.customer;
      WebhookDispatcher.dispatch(shopId, "high_intent_reached", {
        event: "high_intent_reached",
        shopDomain,
        visitorId,
        status: visitor.status,
        intentScore: intent.score,
        intentTier: intent.tier,
        timestamp: new Date().toISOString(),
        customer: customer
          ? {
              email: customer.emailReference || undefined,
              phone: customer.phoneReference || undefined,
              firstName: customer.firstName || undefined,
              lastName: customer.lastName || undefined,
              shopifyCustomerId: customer.shopifyCustomerId,
            }
          : undefined,
        recentEvents: events.slice(0, 5).map((e) => ({
          eventType: e.eventType,
          timestamp: e.timestamp.toISOString(),
          productId: e.productId,
          pageUrl: e.pageUrl,
        })),
      });
    }

    // High-Intent Cart Abandonment Trigger
    if (addToCart > 0 && checkoutsCompleted === 0 && intent.score >= 50) {
      const customer = visitor.customerLinks[0]?.customer;
      WebhookDispatcher.dispatch(shopId, "cart_abandoned", {
        event: "cart_abandoned",
        shopDomain,
        visitorId,
        status: visitor.status,
        intentScore: intent.score,
        intentTier: intent.tier,
        cartValue: cartVal,
        itemsInCart: addToCart,
        timestamp: new Date().toISOString(),
        customer: customer
          ? {
              email: customer.emailReference || undefined,
              phone: customer.phoneReference || undefined,
              firstName: customer.firstName || undefined,
              lastName: customer.lastName || undefined,
              shopifyCustomerId: customer.shopifyCustomerId,
            }
          : undefined,
        recentEvents: events.slice(0, 5).map((e) => ({
          eventType: e.eventType,
          timestamp: e.timestamp.toISOString(),
          productId: e.productId,
          pageUrl: e.pageUrl,
        })),
      });
    }

    return intent;
  } catch (err) {
    console.error("Error processing visitor intent triggers:", err);
  }
}
