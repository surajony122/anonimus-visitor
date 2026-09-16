import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import React, { useState } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  Badge,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Divider,
  ProgressBar,
  Banner,
  List,
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  let visitor: any = null;
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (shop) {
      const visitorParam = params.id!;
      visitor = await prisma.visitor.findFirst({
        where: {
          shopId: shop.id,
          OR: [{ id: visitorParam }, { visitorId: visitorParam }],
        },
        include: {
          sessions: { orderBy: { startedAt: "desc" } },
          events: { orderBy: { timestamp: "asc" } },
          identities: true,
          customerLinks: { include: { customer: true } },
          auditLogs: { orderBy: { timestamp: "desc" } },
        },
      });
    }
  } catch (dbErr) {
    console.warn("Visitor detail DB fallback:", dbErr);
  }

  if (!visitor) {
    visitor = {
      id: "demo",
      visitorId: params.id || "anonymous-visitor",
      status: "anonymous",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      deviceCategory: "desktop",
      sessions: [],
      events: [],
      identities: [],
      customerLinks: [],
      auditLogs: [],
    };
  }

  const pViews = visitor.events.filter((e) => e.eventType === "product_viewed").length;
  const uniqueProductIds = new Set(
    visitor.events
      .filter((e) => e.eventType === "product_viewed" && e.productId)
      .map((e) => e.productId!)
  );
  const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
  const cViews = visitor.events.filter((e) => e.eventType === "collection_viewed").length;
  const searches = visitor.events.filter((e) => e.eventType === "search_submitted").length;
  const addToCart = visitor.events.filter((e) => e.eventType === "product_added_to_cart").length;
  const cartViews = visitor.events.filter((e) => e.eventType === "cart_viewed").length;
  const checkouts = visitor.events.filter((e) => e.eventType === "checkout_started").length;
  const checkoutsCompleted = visitor.events.filter((e) => e.eventType === "checkout_completed").length;

  let cartVal = 0;
  visitor.events.forEach((e) => {
    if (e.metadata) {
      try {
        const meta = JSON.parse(e.metadata);
        if (meta.cartValue || meta.price) {
          cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
        }
      } catch {}
    }
  });

  const intent = calculateIntentScore({
    productViewsCount: pViews,
    repeatProductViews: repeatViews,
    collectionViewsCount: cViews,
    searchesCount: searches,
    addedToCartCount: addToCart,
    cartViewedCount: cartViews,
    cartValue: cartVal,
    checkoutStartedCount: checkouts,
    checkoutCompletedCount: checkoutsCompleted,
    sessionsCount: visitor.sessions.length || 1,
  });

  return json({
    visitor: {
      id: visitor.id,
      visitorId: visitor.visitorId,
      status: visitor.status,
      intentScore: intent.score,
      intentTier: intent.tier,
      intentBreakdown: intent.breakdown,
      events: visitor.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        timestamp: e.timestamp.toISOString(),
        productId: e.productId,
        pageUrl: e.pageUrl,
        metadata: e.metadata,
      })),
      identities: visitor.identities.map((i) => ({
        id: i.id,
        identityType: i.identityType,
        source: i.source,
        confidenceScore: i.confidenceScore,
        createdAt: i.createdAt.toISOString(),
      })),
      customer: visitor.customerLinks[0]?.customer || null,
      auditLogs: visitor.auditLogs.map((a) => ({
        id: a.id,
        action: a.action,
        source: a.source,
        confidence: a.confidence,
        timestamp: a.timestamp.toISOString(),
      })),
    },
  });
};

export default function VisitorDetailRoute() {
  const { visitor } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const isIdentified = visitor.status === "identified";
  const customer = visitor.customer;
  const identities = visitor.identities;
  const events = visitor.events;
  const auditLogs = visitor.auditLogs;

  return (
    <Page
      fullWidth
      title={
        isIdentified
          ? customer?.firstName
            ? `${customer.firstName} ${customer.lastName || ""}`
            : identities[0]?.identityType === "email"
            ? "Identified Customer"
            : `Identified Visitor #${visitor.visitorId.substring(0, 8)}`
          : `Anonymous Visitor #${visitor.visitorId.substring(0, 8)}`
      }
      subtitle={`Persistent Visitor ID: ${visitor.visitorId}`}
      backAction={{ content: "Back to Visitors", onAction: () => navigate("/app/visitors") }}
    >
      <BlockStack gap="400">
        {isIdentified ? (
          <Banner title="Identified & Linked Customer Journey" tone="success">
            <p>
              This visitor was previously anonymous. When a legitimate identity signal was received, all historical anonymous events remained attached and connected to this identity record.
            </p>
          </Banner>
        ) : (
          <Banner title="Anonymous Visitor (No Presumed Identity)" tone="info">
            <p>
              This visitor is browsing without providing personal identifiers. The application maintains an anonymous state with intent intelligence and will never guess identity from weak signals (such as IP or device fingerprints).
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <LegacyCard title="Customer Historical Journey & Event Timeline" sectioned>
              <BlockStack gap="400">
                <Text variant="bodySm" tone="subdued" as="p">
                  Chronological trail showing early anonymous touchpoints connected seamlessly to any subsequent identification events.
                </Text>

                <div style={{ position: "relative", paddingLeft: "24px", borderLeft: "2px solid #e1e3e5" }}>
                  {events.length === 0 ? (
                    <Text variant="bodyMd" tone="subdued" as="p">No events recorded for this visitor.</Text>
                  ) : (
                    events.map((evt: any, idx: number) => {
                      const dateStr = new Date(evt.timestamp).toLocaleString();
                      let metaObj: any = {};
                      try {
                        if (evt.metadata) metaObj = JSON.parse(evt.metadata);
                      } catch {}

                      let badgeTone: "success" | "attention" | "info" | undefined = undefined;
                      if (evt.eventType === "checkout_completed") badgeTone = "success";
                      else if (evt.eventType === "product_added_to_cart") badgeTone = "attention";
                      else if (evt.eventType === "checkout_started") badgeTone = "attention";

                      return (
                        <div key={evt.id || idx} style={{ marginBottom: "24px", position: "relative" }}>
                          <div
                            style={{
                              position: "absolute",
                              left: "-31px",
                              top: "2px",
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              backgroundColor:
                                evt.eventType === "checkout_completed"
                                  ? "#008060"
                                  : evt.eventType === "product_added_to_cart"
                                  ? "#d97706"
                                  : "#5c5f62",
                              border: "2px solid white",
                            }}
                          />
                          <BlockStack gap="100">
                            <InlineStack gap="200" align="start">
                              <Badge tone={badgeTone}>{evt.eventType.replace(/_/g, " ").toUpperCase()}</Badge>
                              <Text variant="bodySm" tone="subdued" as="span">{dateStr}</Text>
                            </InlineStack>

                            {evt.productId && (
                              <Text variant="bodyMd" as="p">
                                <strong>Product ID:</strong> {evt.productId} {metaObj.title ? `(${metaObj.title})` : ""}
                              </Text>
                            )}

                            {evt.pageUrl && (
                              <Text variant="bodySm" tone="subdued" as="p">
                                <strong>URL:</strong> {evt.pageUrl}
                              </Text>
                            )}

                            {metaObj.cartValue && (
                              <Text variant="bodySm" as="p">
                                <strong>Cart Value:</strong> ${metaObj.cartValue}
                              </Text>
                            )}
                          </BlockStack>
                        </div>
                      );
                    })
                  )}
                </div>
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="Identity Decision Audit Trail" sectioned>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Immutable security audit log of every identity resolution and customer matching decision.
                </Text>
                {auditLogs.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">No identity transition events yet (visitor is purely anonymous).</Text>
                ) : (
                  <List type="bullet">
                    {auditLogs.map((log: any) => (
                      <List.Item key={log.id}>
                        <strong>{new Date(log.timestamp).toLocaleString()}:</strong> Action{" "}
                        <code>{log.action}</code> via <code>{log.source}</code> {`(Confidence: ${log.confidence}/100)`}
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <LegacyCard title="Behavioral Intent Score" sectioned>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">{`${visitor.intentScore} / 100`}</Text>
                  <Badge tone={visitor.intentTier === "very_high" ? "success" : visitor.intentTier === "high" ? "attention" : undefined}>
                    {`${visitor.intentTier?.toUpperCase()} INTENT`}
                  </Badge>
                </InlineStack>
                <ProgressBar progress={visitor.intentScore} size="small" tone={visitor.intentScore > 60 ? "success" : "highlight"} />

                <Divider />
                <Text variant="headingXs" as="h4">Score Factors Breakdown:</Text>
                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Product Engagement</Text>
                  <Text variant="bodySm" fontWeight="bold" as="span">{`${visitor.intentBreakdown?.productEngagement || 0} pts`}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Cart Activity</Text>
                  <Text variant="bodySm" fontWeight="bold" as="span">{`${visitor.intentBreakdown?.cartActivity || 0} pts`}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Checkout Progress</Text>
                  <Text variant="bodySm" fontWeight="bold" as="span">{`${visitor.intentBreakdown?.checkoutProgress || 0} pts`}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Session Depth</Text>
                  <Text variant="bodySm" fontWeight="bold" as="span">{`${visitor.intentBreakdown?.sessionDepth || 0} pts`}</Text>
                </InlineStack>
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="Identity Graph" sectioned>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h4">Resolved Identifiers</Text>

                {identities.length === 0 ? (
                  <Text variant="bodySm" tone="subdued" as="p">
                    No verified identity linked yet.
                  </Text>
                ) : (
                  identities.map((idnt: any) => (
                    <BlockStack key={idnt.id} gap="100">
                      <InlineStack align="space-between">
                        <Badge tone="info">{idnt.identityType.toUpperCase()}</Badge>
                        <Badge tone="success">{`${idnt.confidenceScore}% Confident`}</Badge>
                      </InlineStack>
                      <Text variant="bodySm" as="p">
                        <strong>Source:</strong> {idnt.source}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        Linked: {new Date(idnt.createdAt).toLocaleDateString()}
                      </Text>
                      <Divider />
                    </BlockStack>
                  ))
                )}

                {customer && (
                  <BlockStack gap="100">
                    <Text variant="headingXs" as="h4">Shopify Customer Record</Text>
                    <Text variant="bodySm" as="p">
                      <strong>Name:</strong> {customer.firstName} {customer.lastName}
                    </Text>
                    <Text variant="bodySm" as="p">
                      <strong>Shopify Customer ID:</strong> {customer.shopifyCustomerId}
                    </Text>
                    <Text variant="bodySm" as="p">
                      <strong>Total Orders:</strong> {`${customer.ordersCount} ($${customer.totalSpent})`}
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
