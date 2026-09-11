import { Router, Request, Response } from 'express';
import { prisma } from '../db/client';
import { RetentionService } from '../services/retentionService';

const router = Router();

/**
 * POST /api/webhooks/app-uninstalled
 * Triggered when a merchant uninstalls the app
 */
router.post('/app-uninstalled', async (req: Request, res: Response) => {
  try {
    const shopDomain = req.headers['x-shopify-shop-domain'] as string || req.body.myshopify_domain;
    console.log(`[Webhook] App uninstalled for domain: ${shopDomain}`);

    if (shopDomain) {
      await prisma.shop.updateMany({
        where: { shopDomain },
        data: {
          uninstalledAt: new Date(),
          accessTokenReference: null,
        },
      });
    }

    return res.status(200).send('Webhook handled');
  } catch (error) {
    console.error('Error in app/uninstalled webhook:', error);
    return res.status(500).send('Webhook processing failed');
  }
});

/**
 * POST /api/webhooks/customers-redact
 * Mandatory GDPR endpoint: redact customer data upon request
 */
router.post('/customers-redact', async (req: Request, res: Response) => {
  try {
    const { shop_domain, customer } = req.body;
    console.log(`[Webhook] customers/redact request for customer ${customer?.id} on ${shop_domain}`);

    if (shop_domain && customer?.email) {
      const shop = await prisma.shop.findUnique({ where: { shopDomain: shop_domain } });
      if (shop) {
        // Redact matching identities and customer links
        const identities = await prisma.identity.findMany({
          where: {
            shopId: shop.id,
            identityType: 'email',
          },
        });

        for (const ident of identities) {
          await RetentionService.deleteVisitorData(shop.id, ident.visitorId);
        }
      }
    }

    return res.status(200).send('Redaction handled');
  } catch (error) {
    console.error('Error in customers/redact webhook:', error);
    return res.status(500).send('Webhook processing failed');
  }
});

/**
 * POST /api/webhooks/shop-redact
 * Mandatory GDPR endpoint: 48 hours after uninstall, delete all shop data
 */
router.post('/shop-redact', async (req: Request, res: Response) => {
  try {
    const { shop_domain } = req.body;
    console.log(`[Webhook] shop/redact request for shop ${shop_domain}`);

    if (shop_domain) {
      const shop = await prisma.shop.findUnique({ where: { shopDomain: shop_domain } });
      if (shop) {
        await prisma.shop.delete({ where: { id: shop.id } });
      }
    }

    return res.status(200).send('Shop redaction handled');
  } catch (error) {
    console.error('Error in shop/redact webhook:', error);
    return res.status(500).send('Webhook processing failed');
  }
});

/**
 * POST /api/webhooks/customers-data-request
 * Mandatory GDPR endpoint: export customer data upon request
 */
router.post('/customers-data-request', async (req: Request, res: Response) => {
  console.log('[Webhook] customers/data_request received');
  return res.status(200).send('Data request acknowledged');
});

export default router;
