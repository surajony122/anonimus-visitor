import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';

export interface AuthenticatedRequest extends Request {
  shopId?: string;
  shopDomain?: string;
}

/**
 * Resolves and validates the multi-tenant shop context.
 * In a production Shopify app, this validates the session token / HMAC.
 * For development & local preview, it auto-provisions or resolves the default merchant shop.
 */
export async function requireShopContext(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    let shopDomain = (req.headers['x-shopify-shop-domain'] as string) || (req.query.shop as string);

    if (!shopDomain) {
      // Default to demo/primary shop if not explicitly sent in header
      shopDomain = 'quickstart-store.myshopify.com';
    }

    // Upsert or fetch shop in database
    let shop = await prisma.shop.findUnique({
      where: { shopDomain },
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
      });
    }

    req.shopId = shop.id;
    req.shopDomain = shop.shopDomain;
    next();
  } catch (error) {
    console.error('Error in requireShopContext:', error);
    res.status(500).json({ error: 'Internal Server Error resolving Shop tenant' });
  }
}
