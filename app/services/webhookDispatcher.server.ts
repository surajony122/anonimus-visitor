import crypto from "crypto";
import prisma from "../db.server";

export interface WebhookPayload {
  event: "high_intent_reached" | "cart_abandoned" | "identity_resolved";
  shopDomain: string;
  visitorId: string;
  status: string;
  intentScore: number;
  intentTier: string;
  timestamp: string;
  customer?: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    shopifyCustomerId?: string;
  } | null;
  recentEvents?: Array<{
    eventType: string;
    timestamp: string;
    productId?: string | null;
    pageUrl?: string | null;
    cartValue?: number | null;
  }>;
  metadata?: Record<string, any>;
}

export class WebhookDispatcher {
  static async dispatch(
    shopId: string,
    eventTrigger: "high_intent_reached" | "cart_abandoned" | "identity_resolved",
    payload: WebhookPayload
  ) {
    try {
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: {
          shopId,
          isActive: true,
          OR: [{ triggerOn: eventTrigger }, { triggerOn: "all" }],
        },
      });

      if (!endpoints || endpoints.length === 0) {
        return;
      }

      const jsonPayload = JSON.stringify(payload);

      endpoints.forEach(async (endpoint) => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "Nitro-Visitor-Intelligence-Webhook/1.0",
            "X-Nitro-Event": eventTrigger,
            "X-Nitro-Shop": payload.shopDomain,
          };

          if (endpoint.secret) {
            const hmac = crypto
              .createHmac("sha256", endpoint.secret)
              .update(jsonPayload)
              .digest("hex");
            headers["X-Nitro-Signature-SHA256"] = hmac;
          }

          const response = await fetch(endpoint.url, {
            method: "POST",
            headers,
            body: jsonPayload,
            signal: AbortSignal.timeout(5000),
          });

          const responseStatus = response.status;
          let responseBody = "";
          try {
            responseBody = (await response.text()).substring(0, 500);
          } catch {}

          await prisma.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { lastTriggeredAt: new Date() },
          });

          await prisma.webhookDeliveryLog.create({
            data: {
              webhookEndpointId: endpoint.id,
              eventTrigger,
              payload: jsonPayload,
              responseStatus,
              responseBody,
              success: response.ok,
            },
          });
        } catch (err: any) {
          console.error(`Webhook dispatch error for endpoint ${endpoint.id}:`, err);
          try {
            await prisma.webhookDeliveryLog.create({
              data: {
                webhookEndpointId: endpoint.id,
                eventTrigger,
                payload: jsonPayload,
                responseStatus: 0,
                responseBody: err.message || "Connection failed",
                success: false,
              },
            });
          } catch {}
        }
      });
    } catch (err) {
      console.error("Error fetching webhook endpoints:", err);
    }
  }

  static async sendTest(endpointId: string) {
    const endpoint = await prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
      include: { shop: true },
    });

    if (!endpoint) throw new Error("Endpoint not found");

    const testPayload: WebhookPayload = {
      event: (endpoint.triggerOn === "all" ? "high_intent_reached" : endpoint.triggerOn) as any,
      shopDomain: endpoint.shop?.shopDomain || "store.myshopify.com",
      visitorId: "test-visitor-uuid-12345",
      status: "identified",
      intentScore: 92,
      intentTier: "very_high",
      timestamp: new Date().toISOString(),
      customer: {
        email: "test.customer@example.com",
        phone: "+15551234567",
        firstName: "Test",
        lastName: "Lead",
      },
      recentEvents: [
        {
          eventType: "product_viewed",
          timestamp: new Date().toISOString(),
          productId: "gid://shopify/Product/12345678",
          pageUrl: "https://store.myshopify.com/products/example",
        },
        {
          eventType: "product_added_to_cart",
          timestamp: new Date().toISOString(),
          cartValue: 149.99,
        },
      ],
      metadata: { isTestPayload: true },
    };

    const jsonPayload = JSON.stringify(testPayload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Nitro-Visitor-Intelligence-Webhook/1.0",
      "X-Nitro-Event": "test",
      "X-Nitro-Shop": testPayload.shopDomain,
    };

    if (endpoint.secret) {
      const hmac = crypto
        .createHmac("sha256", endpoint.secret)
        .update(jsonPayload)
        .digest("hex");
      headers["X-Nitro-Signature-SHA256"] = hmac;
    }

    const startTime = Date.now();
    let responseStatus = 0;
    let responseBody = "";
    let isSuccess = false;

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers,
        body: jsonPayload,
        signal: AbortSignal.timeout(6000),
      });

      responseStatus = response.status;
      isSuccess = response.ok;
      try {
        responseBody = (await response.text()).substring(0, 500);
      } catch {}
    } catch (err: any) {
      responseBody = err.message || "Connection timeout or failed";
    }

    const durationMs = Date.now() - startTime;

    await prisma.webhookDeliveryLog.create({
      data: {
        webhookEndpointId: endpoint.id,
        eventTrigger: "test",
        payload: jsonPayload,
        responseStatus,
        responseBody,
        success: isSuccess,
      },
    });

    return {
      success: isSuccess,
      responseStatus,
      responseBody,
      durationMs,
    };
  }
}
