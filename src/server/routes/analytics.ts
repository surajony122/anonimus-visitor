import { Router } from 'express';
import { prisma } from '../db/client';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { calculateIntentScore } from '../services/intentEngine';

const router = Router();

/**
 * GET /api/analytics/overview
 * Overview metrics for dashboard
 */
router.get('/overview', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;

    const [
      totalVisitors,
      anonymousVisitors,
      identifiedVisitors,
      totalSessions,
      totalEvents,
      pageViews,
      productViews,
      addCartEvents,
      checkoutEvents,
      completedOrders,
      allVisitors,
    ] = await Promise.all([
      prisma.visitor.count({ where: { shopId } }),
      prisma.visitor.count({ where: { shopId, status: 'anonymous' } }),
      prisma.visitor.count({ where: { shopId, status: 'identified' } }),
      prisma.session.count({ where: { shopId } }),
      prisma.event.count({ where: { shopId } }),
      prisma.event.count({ where: { shopId, eventType: 'page_viewed' } }),
      prisma.event.count({ where: { shopId, eventType: 'product_viewed' } }),
      prisma.event.count({ where: { shopId, eventType: 'product_added_to_cart' } }),
      prisma.event.count({ where: { shopId, eventType: 'checkout_started' } }),
      prisma.event.count({ where: { shopId, eventType: 'checkout_completed' } }),
      prisma.visitor.findMany({
        where: { shopId },
        include: {
          events: true,
          sessions: true,
        },
      }),
    ]);

    const identificationRate =
      totalVisitors > 0 ? ((identifiedVisitors / totalVisitors) * 100).toFixed(1) : '0.0';

    // Calculate intent tiers across all visitors
    let lowIntent = 0;
    let mediumIntent = 0;
    let highIntent = 0;
    let veryHighIntent = 0;

    allVisitors.forEach((v) => {
      const pViews = v.events.filter((e) => e.eventType === 'product_viewed').length;
      const addToCart = v.events.filter((e) => e.eventType === 'product_added_to_cart').length;
      const checkouts = v.events.filter((e) => e.eventType === 'checkout_started').length;
      const checkoutsDone = v.events.filter((e) => e.eventType === 'checkout_completed').length;

      const score = calculateIntentScore({
        productViewsCount: pViews,
        addedToCartCount: addToCart,
        checkoutStartedCount: checkouts,
        checkoutCompletedCount: checkoutsDone,
        sessionsCount: v.sessions.length,
      });

      if (score.tier === 'very_high') veryHighIntent++;
      else if (score.tier === 'high') highIntent++;
      else if (score.tier === 'medium') mediumIntent++;
      else lowIntent++;
    });

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVisitors,
          anonymousVisitors,
          identifiedVisitors,
          identificationRate: `${identificationRate}%`,
          totalSessions,
          totalEvents,
          highIntentVisitors: highIntent + veryHighIntent,
        },
        funnel: {
          pageViews,
          productViews,
          addToCarts: addCartEvents,
          checkoutsStarted: checkoutEvents,
          ordersCompleted: completedOrders,
        },
        intentDistribution: {
          low: lowIntent,
          medium: mediumIntent,
          high: highIntent,
          veryHigh: veryHighIntent,
        },
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/analytics/overview:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
