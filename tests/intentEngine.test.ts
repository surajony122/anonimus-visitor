import { describe, it, expect } from 'vitest';
import { calculateIntentScore } from '../src/server/services/intentEngine';

describe('Intent Engine Service', () => {
  it('computes low intent score for a single bounce page view', () => {
    const result = calculateIntentScore({
      pageViewsCount: 1,
      productViewsCount: 0,
      addedToCartCount: 0,
    });
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.tier).toBe('low');
  });

  it('computes medium intent for multiple product and collection views', () => {
    const result = calculateIntentScore({
      pageViewsCount: 5,
      productViewsCount: 4,
      collectionViewsCount: 2,
      searchesCount: 1,
    });
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('computes high/very high intent for repeat views, add to cart, and checkout start', () => {
    const result = calculateIntentScore({
      pageViewsCount: 6,
      productViewsCount: 4,
      repeatProductViews: 2,
      addedToCartCount: 1,
      cartViewedCount: 1,
      cartValue: 150,
      checkoutStartedCount: 1,
      sessionDurationMinutes: 5,
    });
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.tier === 'high' || result.tier === 'very_high').toBe(true);
    expect(result.breakdown.cartActivity).toBeGreaterThan(0);
    expect(result.breakdown.checkoutProgress).toBeGreaterThan(0);
  });
});
