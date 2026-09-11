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
  score: number; // 0 to 100
  tier: 'low' | 'medium' | 'high' | 'very_high';
  breakdown: {
    productEngagement: number;
    cartActivity: number;
    checkoutProgress: number;
    sessionDepth: number;
  };
}

export interface IntentConfig {
  productViewWeight: number;       // default 5
  repeatProductViewWeight: number; // default 10
  collectionViewWeight: number;   // default 2
  searchWeight: number;           // default 4
  addToCartWeight: number;        // default 25
  cartViewWeight: number;         // default 15
  highCartValueBonus: number;     // default 15 (if cart >= 100)
  checkoutStartedWeight: number;  // default 30
  checkoutCompletedWeight: number;// default 50
  sessionDepthWeight: number;     // default 10
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
};

/**
 * Calculates a 0-100 Intent Score from visitor behavioral events.
 * High-intent visitors show strong indicators like repeat product views, add to cart, and checkout progression.
 */
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

  // 1. Product Engagement Component (Max 35 pts)
  let productEngagement =
    pViews * config.productViewWeight +
    repeatViews * config.repeatProductViewWeight +
    cViews * config.collectionViewWeight +
    searches * config.searchWeight;
  productEngagement = Math.min(35, productEngagement);

  // 2. Cart Activity Component (Max 35 pts)
  let cartActivity =
    addToCart * config.addToCartWeight +
    cartViews * config.cartViewWeight +
    (cartVal >= 100 ? config.highCartValueBonus : 0);
  cartActivity = Math.min(35, cartActivity);

  // 3. Checkout Progression Component (Max 40 pts)
  let checkoutProgress =
    checkoutsStarted * config.checkoutStartedWeight +
    checkoutsCompleted * config.checkoutCompletedWeight;
  checkoutProgress = Math.min(40, checkoutProgress);

  // 4. Session Depth Component (Max 15 pts)
  let sessionDepth = (duration > 3 ? config.sessionDepthWeight : 0) + (sessions > 1 ? 5 : 0);
  sessionDepth = Math.min(15, sessionDepth);

  const rawScore = productEngagement + cartActivity + checkoutProgress + sessionDepth;
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  let tier: 'low' | 'medium' | 'high' | 'very_high' = 'low';
  if (finalScore >= 81) {
    tier = 'very_high';
  } else if (finalScore >= 61) {
    tier = 'high';
  } else if (finalScore >= 31) {
    tier = 'medium';
  } else {
    tier = 'low';
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
