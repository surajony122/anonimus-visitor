import { Router } from 'express';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { validateBody, IdentifyPayloadSchema } from '../middleware/validator';
import { IdentityEngine } from '../services/identityEngine';

const router = Router();

/**
 * POST /api/identity/identify
 * Connects an anonymous visitor to a verified identity (email, phone, google, customer account)
 */
router.post('/identify', requireShopContext, validateBody(IdentifyPayloadSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { visitor_id, type, value, source, confidence_score, metadata } = req.body;

    const result = await IdentityEngine.identify({
      shopId,
      visitorId: visitor_id,
      type,
      rawValue: value,
      source,
      confidenceScore: confidence_score ?? 100,
      metadata,
    });

    return res.status(200).json({
      message: 'Identity resolved successfully',
      ...result,
    });
  } catch (error: any) {
    console.error('Error in /api/identity/identify:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to resolve identity',
    });
  }
});

/**
 * GET /api/identity/graph/:visitorId
 * Returns the identity graph and audit trail for a visitor
 */
router.get('/graph/:visitorId', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { visitorId } = req.params;

    const graph = await IdentityEngine.getVisitorIdentityGraph(shopId, visitorId);
    return res.status(200).json({ success: true, graph });
  } catch (error: any) {
    console.error('Error in /api/identity/graph:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
