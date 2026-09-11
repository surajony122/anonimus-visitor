import { Router } from 'express';
import { prisma } from '../db/client';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { validateBody, EventPayloadSchema } from '../middleware/validator';

const router = Router();

/**
 * POST /api/events
 * Ingests a storefront event from Web Pixel or Storefront Tracker
 */
router.post('/', requireShopContext, validateBody(EventPayloadSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
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
    } = req.body;

    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();

    // 1. Check shop privacy settings: is tracking enabled?
    const privacy = await prisma.privacySetting.findUnique({
      where: { shopId },
    });

    if (privacy && !privacy.trackingEnabled) {
      return res.status(200).json({ success: true, ignored: true, reason: 'Tracking is disabled by merchant' });
    }

    // 2. Ensure visitor record exists
    let visitor = await prisma.visitor.findUnique({
      where: {
        shopId_visitorId: {
          shopId,
          visitorId: visitor_id,
        },
      },
    });

    if (!visitor) {
      const userAgent = (req.headers['user-agent'] as string) || '';
      const isMobile = /mobile|iphone|android|ipad/i.test(userAgent);

      visitor = await prisma.visitor.create({
        data: {
          shopId,
          visitorId: visitor_id,
          status: 'anonymous',
          firstSeenAt: eventTimestamp,
          lastSeenAt: eventTimestamp,
          deviceCategory: isMobile ? 'mobile' : 'desktop',
          firstSource: (metadata?.referrer as string) || req.headers['referer'] || 'direct',
          lastSource: (metadata?.referrer as string) || req.headers['referer'] || 'direct',
        },
      });
    } else {
      // Update last seen
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: eventTimestamp },
      });
    }

    // 3. Ensure session record exists if session_id is provided
    let finalSessionId: string | null = null;
    if (session_id) {
      let session = await prisma.session.findUnique({
        where: { id: session_id },
      });

      if (!session) {
        session = await prisma.session.create({
          data: {
            id: session_id,
            shopId,
            visitorId: visitor_id,
            startedAt: eventTimestamp,
            lastActivityAt: eventTimestamp,
            landingPage: page_url,
            referrer: (metadata?.referrer as string) || (req.headers['referer'] as string) || null,
            utmSource: (metadata?.utm_source as string) || null,
            utmMedium: (metadata?.utm_medium as string) || null,
            utmCampaign: (metadata?.utm_campaign as string) || null,
          },
        });
      } else {
        await prisma.session.update({
          where: { id: session.id },
          data: { lastActivityAt: eventTimestamp },
        });
      }
      finalSessionId = session.id;
    }

    // 4. Create Event Record
    const event = await prisma.event.create({
      data: {
        shopId,
        visitorId: visitor_id,
        sessionId: finalSessionId,
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

    return res.status(201).json({
      success: true,
      event_id: event.eventId,
      visitor_id: visitor.visitorId,
      status: visitor.status,
    });
  } catch (error) {
    console.error('Error in /api/events:', error);
    return res.status(500).json({ error: 'Internal Server Error ingesting event' });
  }
});

export default router;
