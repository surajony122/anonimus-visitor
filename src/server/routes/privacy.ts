import { Router } from 'express';
import { prisma } from '../db/client';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { RetentionService } from '../services/retentionService';

const router = Router();

/**
 * GET /api/privacy/settings
 */
router.get('/settings', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;

    let settings = await prisma.privacySetting.findUnique({
      where: { shopId },
    });

    if (!settings) {
      settings = await prisma.privacySetting.create({
        data: {
          shopId,
          retentionDays: 90,
          trackingEnabled: true,
          analyticsEnabled: true,
          marketingTrackingEnabled: true,
        },
      });
    }

    return res.status(200).json({ success: true, settings });
  } catch (error: any) {
    console.error('Error in GET /api/privacy/settings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/privacy/settings
 */
router.post('/settings', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { retentionDays, trackingEnabled, analyticsEnabled, marketingTrackingEnabled, consentModeRequired } = req.body;

    const settings = await prisma.privacySetting.upsert({
      where: { shopId },
      update: {
        retentionDays: retentionDays !== undefined ? Number(retentionDays) : undefined,
        trackingEnabled: trackingEnabled !== undefined ? Boolean(trackingEnabled) : undefined,
        analyticsEnabled: analyticsEnabled !== undefined ? Boolean(analyticsEnabled) : undefined,
        marketingTrackingEnabled: marketingTrackingEnabled !== undefined ? Boolean(marketingTrackingEnabled) : undefined,
        consentModeRequired: consentModeRequired !== undefined ? Boolean(consentModeRequired) : undefined,
      },
      create: {
        shopId,
        retentionDays: Number(retentionDays || 90),
        trackingEnabled: trackingEnabled ?? true,
        analyticsEnabled: analyticsEnabled ?? true,
        marketingTrackingEnabled: marketingTrackingEnabled ?? true,
        consentModeRequired: consentModeRequired ?? false,
      },
    });

    return res.status(200).json({ success: true, settings });
  } catch (error: any) {
    console.error('Error in POST /api/privacy/settings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/privacy/delete-visitor
 * GDPR / CCPA right-to-be-forgotten deletion
 */
router.post('/delete-visitor', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { visitor_id } = req.body;

    if (!visitor_id) {
      return res.status(400).json({ success: false, error: 'visitor_id is required' });
    }

    const result = await RetentionService.deleteVisitorData(shopId, visitor_id);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in POST /api/privacy/delete-visitor:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/privacy/purge-expired
 * Trigger retention window expiration cleanup
 */
router.post('/purge-expired', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const result = await RetentionService.purgeExpiredData(shopId);
    return res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('Error in POST /api/privacy/purge-expired:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/privacy/export/:visitorId
 * GDPR data portability export
 */
router.get('/export/:visitorId', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { visitorId } = req.params;

    const visitor = await prisma.visitor.findUnique({
      where: { shopId_visitorId: { shopId, visitorId } },
      include: {
        sessions: true,
        events: true,
        identities: true,
        customerLinks: true,
      },
    });

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found' });
    }

    return res.status(200).json({
      success: true,
      export: {
        exportedAt: new Date().toISOString(),
        shopId,
        visitor,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/privacy/export:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
