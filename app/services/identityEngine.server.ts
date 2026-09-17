import prisma from "../db.server";
import { normalizeEmail, normalizePhone, hashIdentityValue, encryptValue } from "./normalizer.server";

export type IdentityType = "email" | "phone" | "shopify_customer" | "google_account" | "merchant_identifier";
export type IdentitySource = "user_submitted" | "checkout" | "shopify_customer" | "google_oauth" | "merchant_confirmed";

export interface ResolveIdentityParams {
  shopId: string;
  visitorId: string;
  type: IdentityType;
  rawValue: string;
  source: IdentitySource;
  confidenceScore?: number;
  metadata?: Record<string, any>;
}

export interface ResolveIdentityResult {
  success: boolean;
  visitorId: string;
  identityId: string;
  status: "newly_identified" | "already_identified" | "merged";
  confidenceScore: number;
  matchedCustomer?: {
    shopifyCustomerId: string;
    emailReference?: string;
  };
}

export class IdentityEngine {
  public static async identify(params: ResolveIdentityParams): Promise<ResolveIdentityResult> {
    const { shopId, visitorId, type, rawValue, source, metadata } = params;

    if (!shopId || !visitorId || !type || !rawValue) {
      throw new Error("Missing required identity resolution parameters");
    }

    let normalizedValue = "";
    if (type === "email") {
      normalizedValue = normalizeEmail(rawValue);
    } else if (type === "phone") {
      normalizedValue = normalizePhone(rawValue);
    } else {
      normalizedValue = rawValue.trim();
    }

    const valueHash = hashIdentityValue(normalizedValue);
    const encryptedVal = encryptValue(normalizedValue);
    const confidence = params.confidenceScore ?? 100;

    let visitor = await prisma.visitor.findUnique({
      where: {
        shopId_visitorId: {
          shopId,
          visitorId,
        },
      },
      include: {
        identities: true,
      },
    });

    if (!visitor) {
      visitor = await prisma.visitor.create({
        data: {
          shopId,
          visitorId,
          status: "identified",
          deviceCategory: "desktop",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        include: {
          identities: true,
        },
      });
    }

    const existingIdentity = await prisma.identity.findUnique({
      where: {
        shopId_identityType_identityValueHash: {
          shopId,
          identityType: type,
          identityValueHash: valueHash,
        },
      },
    });

    let resultStatus: "newly_identified" | "already_identified" | "merged" = "newly_identified";
    let targetIdentityId = "";

    if (existingIdentity) {
      targetIdentityId = existingIdentity.id;

      if (existingIdentity.visitorId === visitorId) {
        resultStatus = "already_identified";
      } else {
        resultStatus = "merged";

        await prisma.identityLink.create({
          data: {
            sourceIdentityId: existingIdentity.id,
            targetIdentityId: existingIdentity.id,
            relationship: "verified_same_person",
            confidenceScore: confidence,
            source: source,
          },
        });

        await prisma.identityAuditLog.create({
          data: {
            shopId,
            visitorId,
            identityId: existingIdentity.id,
            action: "identity_merged",
            source,
            confidence,
            metadata: JSON.stringify({
              previousVisitorId: existingIdentity.visitorId,
              currentVisitorId: visitorId,
              type,
              ...metadata,
            }),
          },
        });
      }
    } else {
      const createdIdentity = await prisma.identity.create({
        data: {
          shopId,
          visitorId,
          identityType: type,
          identityValueHash: valueHash,
          identityValueEncrypted: encryptedVal,
          source,
          confidenceScore: confidence,
          verified: true,
        },
      });
      targetIdentityId = createdIdentity.id;

      await prisma.identityAuditLog.create({
        data: {
          shopId,
          visitorId,
          identityId: createdIdentity.id,
          action: "identity_created",
          source,
          confidence,
          metadata: JSON.stringify({ type, source, ...metadata }),
        },
      });
    }

    await prisma.visitor.update({
      where: {
        shopId_visitorId: {
          shopId,
          visitorId,
        },
      },
      data: {
        status: "identified",
        lastSeenAt: new Date(),
      },
    });

    let matchedCustomer: { shopifyCustomerId: string; emailReference?: string } | undefined;

    if (type === "email" || type === "shopify_customer" || type === "phone") {
      const customer = await prisma.shopifyCustomer.findFirst({
        where: {
          shopId,
          OR: [
            { emailReference: normalizedValue },
            { phoneReference: normalizedValue },
            { shopifyCustomerId: rawValue },
          ],
        },
      });

      if (customer) {
        matchedCustomer = {
          shopifyCustomerId: customer.shopifyCustomerId,
          emailReference: customer.emailReference || undefined,
        };

        await prisma.visitorCustomerLink.upsert({
          where: {
            shopId_visitorId_shopifyCustomerId: {
              shopId,
              visitorId,
              shopifyCustomerId: customer.shopifyCustomerId,
            },
          },
          update: {
            confidenceScore: 100,
            matchMethod: type === "email" ? "email_exact" : type === "phone" ? "phone_exact" : "authenticated_account",
          },
          create: {
            shopId,
            visitorId,
            shopifyCustomerId: customer.shopifyCustomerId,
            matchMethod: type === "email" ? "email_exact" : type === "phone" ? "phone_exact" : "authenticated_account",
            confidenceScore: 100,
          },
        });

        await prisma.identityAuditLog.create({
          data: {
            shopId,
            visitorId,
            identityId: targetIdentityId,
            action: "customer_matched",
            source: "shopify_customer_match",
            confidence: 100,
            metadata: JSON.stringify({
              shopifyCustomerId: customer.shopifyCustomerId,
              method: type === "email" ? "email_exact" : type === "phone" ? "phone_exact" : "authenticated_account",
            }),
          },
        });
      }
    }

    return {
      success: true,
      visitorId,
      identityId: targetIdentityId,
      status: resultStatus,
      confidenceScore: confidence,
      matchedCustomer,
    };
  }

  public static async getVisitorIdentityGraph(shopId: string, visitorId: string) {
    const identities = await prisma.identity.findMany({
      where: { shopId, visitorId },
      include: { auditLogs: true },
    });

    const customerLinks = await prisma.visitorCustomerLink.findMany({
      where: { shopId, visitorId },
      include: { customer: true },
    });

    const auditLogs = await prisma.identityAuditLog.findMany({
      where: { shopId, visitorId },
      orderBy: { timestamp: "desc" },
    });

    return {
      visitorId,
      identities,
      customerLinks,
      auditLogs,
    };
  }
}
