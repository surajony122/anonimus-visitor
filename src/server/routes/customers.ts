import { Router } from 'express';
import { prisma } from '../db/client';
import { requireShopContext, AuthenticatedRequest } from '../middleware/authMiddleware';
import { CustomerMatcher } from '../services/customerMatcher';

const router = Router();

/**
 * GET /api/customers
 * Returns all Shopify customers synced and their associated visitors
 */
router.get('/', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;

    const customers = await prisma.shopifyCustomer.findMany({
      where: { shopId },
      include: {
        visitorLinks: {
          include: {
            visitor: {
              include: {
                events: true,
                sessions: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      customers,
    });
  } catch (error: any) {
    console.error('Error in GET /api/customers:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/sync
 * Syncs a Shopify customer record (e.g. from Webhook or GraphQL)
 */
router.post('/sync', requireShopContext, async (req: AuthenticatedRequest, res) => {
  try {
    const shopId = req.shopId!;
    const { shopify_customer_id, email, phone, first_name, last_name, orders_count, total_spent } = req.body;

    if (!shopify_customer_id) {
      return res.status(400).json({ success: false, error: 'shopify_customer_id is required' });
    }

    const customer = await CustomerMatcher.syncCustomer({
      shopId,
      shopifyCustomerId: shopify_customer_id,
      email,
      phone,
      firstName: first_name,
      lastName: last_name,
      ordersCount: orders_count,
      totalSpent: total_spent,
    });

    return res.status(200).json({
      success: true,
      customer,
    });
  } catch (error: any) {
    console.error('Error in POST /api/customers/sync:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
