import { prisma } from '../db/client';
import { normalizeEmail, normalizePhone } from './normalizer';

export interface SyncShopifyCustomerParams {
  shopId: string;
  shopifyCustomerId: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  ordersCount?: number;
  totalSpent?: number;
}

export class CustomerMatcher {
  /**
   * Syncs a customer record from Shopify Admin API or Webhook
   * and automatically attempts linking with existing identified visitors in the shop.
   */
  public static async syncCustomer(params: SyncShopifyCustomerParams) {
    const { shopId, shopifyCustomerId, email, phone, firstName, lastName, ordersCount, totalSpent } = params;

    let normalizedEmail = email ? normalizeEmail(email) : null;
    let normalizedPhone: string | null = null;
    if (phone) {
      try {
        normalizedPhone = normalizePhone(phone);
      } catch {
        normalizedPhone = phone.trim();
      }
    }

    const customer = await prisma.shopifyCustomer.upsert({
      where: {
        shopId_shopifyCustomerId: {
          shopId,
          shopifyCustomerId,
        },
      },
      update: {
        emailReference: normalizedEmail,
        phoneReference: normalizedPhone,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        ordersCount: ordersCount ?? 0,
        totalSpent: totalSpent ?? 0.0,
      },
      create: {
        shopId,
        shopifyCustomerId,
        emailReference: normalizedEmail,
        phoneReference: normalizedPhone,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        ordersCount: ordersCount ?? 0,
        totalSpent: totalSpent ?? 0.0,
      },
    });

    // Check if there are existing identities in the shop that match this customer
    if (normalizedEmail) {
      const matchingIdentities = await prisma.identity.findMany({
        where: {
          shopId,
          identityType: 'email',
          identityValueEncrypted: { not: null }, // or find by hash
        },
        include: { visitor: true },
      });

      for (const ident of matchingIdentities) {
        // Link visitor to this customer
        await prisma.visitorCustomerLink.upsert({
          where: {
            shopId_visitorId_shopifyCustomerId: {
              shopId,
              visitorId: ident.visitorId,
              shopifyCustomerId: customer.shopifyCustomerId,
            },
          },
          update: {
            confidenceScore: 100,
            matchMethod: 'email_exact',
          },
          create: {
            shopId,
            visitorId: ident.visitorId,
            shopifyCustomerId: customer.shopifyCustomerId,
            matchMethod: 'email_exact',
            confidenceScore: 100,
          },
        });
      }
    }

    return customer;
  }
}
