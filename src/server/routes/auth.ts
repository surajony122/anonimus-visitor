import { Router, Request, Response } from 'express';
import { prisma } from '../db/client';

const router = Router();

/**
 * GET /api/auth/shopify
 * Shopify OAuth initiation
 */
router.get('/shopify', async (req: Request, res: Response) => {
  const shop = req.query.shop as string;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const apiKey = process.env.SHOPIFY_API_KEY || 'shopify_api_key';
  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`;
  const scopes = 'read_customers,read_orders,read_products';

  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return res.redirect(authUrl);
});

/**
 * GET /api/auth/session
 * Returns the currently active merchant session context
 */
router.get('/session', async (req: Request, res: Response) => {
  const shopDomain = (req.headers['x-shopify-shop-domain'] as string) || (req.query.shop as string) || 'quickstart-store.myshopify.com';

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { privacySettings: true },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopifyShopId: 'gid://shopify/Shop/1234567890',
        installedAt: new Date(),
        settings: JSON.stringify({ name: 'Demo Store', currency: 'USD' }),
        privacySettings: {
          create: {
            retentionDays: 90,
            trackingEnabled: true,
            analyticsEnabled: true,
            marketingTrackingEnabled: true,
          },
        },
      },
      include: { privacySettings: true },
    });
  }

  return res.status(200).json({
    authenticated: true,
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      shopifyShopId: shop.shopifyShopId,
      installedAt: shop.installedAt,
      settings: shop.settings ? JSON.parse(shop.settings) : {},
      privacy: shop.privacySettings,
    },
  });
});

export default router;
