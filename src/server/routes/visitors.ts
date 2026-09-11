import { Router } from 'express';
import { prisma } from '../db/client';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { calculateIntentScore } from '../services/intentEngine';

const router = Router();

/**
 * GET /api/visitors
 * Returns visitors for the shop with intent scores and summaries
 */
router.get('/', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const status = req.query.status as string; // 'anonymous' | 'identified' | 'all'
    const intentTier = req.query.intent as string; // 'low' | 'medium' | 'high' | 'very_high'
    const search = (req.query.search as string || '').toLowerCase();

    const whereClause: any = { shopId };
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const visitors = await prisma.visitor.findMany({
      where: whereClause,
      include: {
        sessions: true,
        events: {
          orderBy: { timestamp: 'desc' },
        },
        identities: true,
        customerLinks: {
          include: {
            customer: true,
          },
        },
      },
      orderBy: { lastSeenAt: 'desc' },
    });

    const enrichedVisitors = visitors.map((v) => {
      // Calculate intent signals
      const pViews = v.events.filter((e) => e.eventType === 'product_viewed').length;
      const uniqueProductIds = new Set(
        v.events.filter((e) => e.eventType === 'product_viewed' && e.productId).map((e) => e.productId!)
      );
      const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
      const cViews = v.events.filter((e) => e.eventType === 'collection_viewed').length;
      const searches = v.events.filter((e) => e.eventType === 'search_submitted').length;
      const addToCart = v.events.filter((e) => e.eventType === 'product_added_to_cart').length;
      const cartViews = v.events.filter((e) => e.eventType === 'cart_viewed').length;
      const checkouts = v.events.filter((e) => e.eventType === 'checkout_started').length;
      const checkoutsCompleted = v.events.filter((e) => e.eventType === 'checkout_completed').length;

      // Extract cart value from metadata if available
      let cartVal = 0;
      v.events.forEach((e) => {
        if (e.metadata) {
          try {
            const meta = JSON.parse(e.metadata);
            if (meta.cartValue || meta.price) {
              cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
            }
          } catch {}
        }
      });

      const intent = calculateIntentScore({
        productViewsCount: pViews,
        repeatProductViews: repeatViews,
        collectionViewsCount: cViews,
        searchesCount: searches,
        addedToCartCount: addToCart,
        cartViewedCount: cartViews,
        cartValue: cartVal,
        checkoutStartedCount: checkouts,
        checkoutCompletedCount: checkoutsCompleted,
        sessionsCount: v.sessions.length || 1,
      });

      const primaryEmail = v.identities.find((i) => i.identityType === 'email')?.identityValueEncrypted || null;
      const primaryPhone = v.identities.find((i) => i.identityType === 'phone')?.identityValueEncrypted || null;
      const shopifyCustomer = v.customerLinks[0]?.customer || null;

      return {
        id: v.id,
        visitorId: v.visitorId,
        status: v.status,
        firstSeenAt: v.firstSeenAt,
        lastSeenAt: v.lastSeenAt,
        deviceCategory: v.deviceCategory || 'desktop',
        firstSource: v.firstSource,
        lastSource: v.lastSource,
        sessionsCount: v.sessions.length,
        eventsCount: v.events.length,
        productsViewedCount: pViews,
        uniqueProductsCount: uniqueProductIds.size,
        cartEventsCount: addToCart,
        cartValue: cartVal,
        intentScore: intent.score,
        intentTier: intent.tier,
        intentBreakdown: intent.breakdown,
        identities: v.identities.map((i) => ({
          id: i.id,
          type: i.identityType,
          source: i.source,
          confidence: i.confidenceScore,
          createdAt: i.createdAt,
        })),
        shopifyCustomer: shopifyCustomer
          ? {
              id: shopifyCustomer.shopifyCustomerId,
              firstName: shopifyCustomer.firstName,
              lastName: shopifyCustomer.lastName,
              ordersCount: shopifyCustomer.ordersCount,
              totalSpent: shopifyCustomer.totalSpent,
            }
          : null,
        primaryEmail,
        primaryPhone,
      };
    });

    // Apply client filters if requested
    let filtered = enrichedVisitors;
    if (intentTier && intentTier !== 'all') {
      filtered = filtered.filter((v) => v.intentTier === intentTier);
    }
    if (search) {
      filtered = filtered.filter(
        (v) =>
          v.visitorId.toLowerCase().includes(search) ||
          (v.shopifyCustomer?.firstName && v.shopifyCustomer.firstName.toLowerCase().includes(search)) ||
          (v.shopifyCustomer?.lastName && v.shopifyCustomer.lastName.toLowerCase().includes(search))
      );
    }

    return res.status(200).json({
      success: true,
      visitors: filtered,
      totalCount: filtered.length,
    });
  } catch (error: any) {
    console.error('Error in GET /api/visitors:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/visitors/:id
 * Detailed view of single visitor
 */
router.get('/:id', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const visitorParam = req.params.id;

    const visitor = await prisma.visitor.findFirst({
      where: {
        shopId,
        OR: [{ id: visitorParam }, { visitorId: visitorParam }],
      },
      include: {
        sessions: { orderBy: { startedAt: 'desc' } },
        events: { orderBy: { timestamp: 'asc' } },
        identities: true,
        customerLinks: {
          include: { customer: true },
        },
        auditLogs: { orderBy: { timestamp: 'desc' } },
      },
    });

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found' });
    }

    const pViews = visitor.events.filter((e) => e.eventType === 'product_viewed').length;
    const uniqueProductIds = new Set(
      visitor.events.filter((e) => e.eventType === 'product_viewed' && e.productId).map((e) => e.productId!)
    );
    const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
    const cViews = visitor.events.filter((e) => e.eventType === 'collection_viewed').length;
    const searches = visitor.events.filter((e) => e.eventType === 'search_submitted').length;
    const addToCart = visitor.events.filter((e) => e.eventType === 'product_added_to_cart').length;
    const cartViews = visitor.events.filter((e) => e.eventType === 'cart_viewed').length;
    const checkouts = visitor.events.filter((e) => e.eventType === 'checkout_started').length;
    const checkoutsCompleted = visitor.events.filter((e) => e.eventType === 'checkout_completed').length;

    let cartVal = 0;
    visitor.events.forEach((e) => {
      if (e.metadata) {
        try {
          const meta = JSON.parse(e.metadata);
          if (meta.cartValue || meta.price) {
            cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
          }
        } catch {}
      }
    });

    const intent = calculateIntentScore({
      productViewsCount: pViews,
      repeatProductViews: repeatViews,
      collectionViewsCount: cViews,
      searchesCount: searches,
      addedToCartCount: addToCart,
      cartViewedCount: cartViews,
      cartValue: cartVal,
      checkoutStartedCount: checkouts,
      checkoutCompletedCount: checkoutsCompleted,
      sessionsCount: visitor.sessions.length || 1,
    });

    return res.status(200).json({
      success: true,
      visitor: {
        ...visitor,
        intentScore: intent.score,
        intentTier: intent.tier,
        intentBreakdown: intent.breakdown,
        productsViewedCount: pViews,
        cartValue: cartVal,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/visitors/:id:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/visitors/:id/events
 * Chronological timeline of all historical events for this visitor
 */
router.get('/:id/events', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const visitorParam = req.params.id;

    const events = await prisma.event.findMany({
      where: {
        shopId,
        OR: [{ visitorId: visitorParam }],
      },
      orderBy: { timestamp: 'asc' },
    });

    return res.status(200).json({
      success: true,
      events,
    });
  } catch (error: any) {
    console.error('Error in GET /api/visitors/:id/events:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
