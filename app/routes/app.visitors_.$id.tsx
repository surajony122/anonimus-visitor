import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRouteError } from "@remix-run/react";
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
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { decryptValue } from "../services/normalizer.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  const visitorParam = params.id!;
  let visitor: any = null;

  try {
    visitor = await prisma.visitor.findFirst({
      where: {
        OR: [{ id: visitorParam }, { visitorId: visitorParam }],
      },
      include: {
        sessions: { orderBy: { startedAt: "desc" } },
        events: { orderBy: { timestamp: "desc" } },
        identities: true,
        customerLinks: { include: { customer: true } },
        auditLogs: { orderBy: { timestamp: "desc" } },
      },
    });
  } catch (dbErr) {
    console.warn("Visitor detail DB query error:", dbErr);
  }

  if (!visitor) {
    visitor = {
      id: visitorParam,
      visitorId: visitorParam,
      status: "anonymous",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      deviceCategory: "desktop",
      metadata: "{}",
      sessions: [],
      events: [],
      identities: [],
      customerLinks: [],
      auditLogs: [],
    };
  }

  // Decrypt contact identities (Email, Phone)
  const decryptedIdentities = (visitor.identities || []).map((i: any) => {
    let plainValue = "";
    const encVal = i.identityValueEncrypted || i.encryptedValue;
    if (encVal) {
      try {
        plainValue = decryptValue(encVal);
      } catch {
        plainValue = "[Protected Value]";
      }
    }
    return {
      id: i.id,
      identityType: i.identityType,
      value: plainValue,
      source: i.source,
      confidenceScore: i.confidenceScore,
      createdAt: i.createdAt ? i.createdAt.toISOString() : new Date().toISOString(),
    };
  });

  const pViews = visitor.events.filter((e: any) => e.eventType === "product_viewed").length;
  const uniqueProductIds = new Set(
    visitor.events
      .filter((e: any) => e.eventType === "product_viewed" && e.productId)
      .map((e: any) => e.productId!)
  );
  const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
  const cViews = visitor.events.filter((e: any) => e.eventType === "collection_viewed").length;
  const searches = visitor.events.filter((e: any) => e.eventType === "search_submitted").length;
  const addToCart = visitor.events.filter((e: any) => e.eventType === "product_added_to_cart").length;
  const cartViews = visitor.events.filter((e: any) => e.eventType === "cart_viewed").length;
  const checkouts = visitor.events.filter((e: any) => e.eventType === "checkout_started").length;
  const checkoutsCompleted = visitor.events.filter((e: any) => e.eventType === "checkout_completed").length;

  let cartVal = 0;
  visitor.events.forEach((e: any) => {
    if (e.metadata) {
      try {
        const meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
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
    sessionsCount: visitor.sessions?.length || 1,
  });

  let clientMeta: any = {};
  try {
    if (visitor.metadata) {
      clientMeta = typeof visitor.metadata === "string" ? JSON.parse(visitor.metadata) : visitor.metadata;
    }
  } catch {}

  const parsedEvents = (visitor.events || []).map((e: any) => {
    let meta: any = {};
    try {
      if (e.metadata) meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
    } catch {}

    // Extract UTM & Campaign signals from URL / search parameters
    let utmSource = "";
    let utmMedium = "";
    let utmCampaign = "";
    let fbclid = "";
    let gclid = "";

    try {
      const urlStr = e.pageUrl || meta.page_url || "";
      if (urlStr.includes("?")) {
        const params = new URL(urlStr).searchParams;
        utmSource = params.get("utm_source") || "";
        utmMedium = params.get("utm_medium") || "";
        utmCampaign = params.get("utm_campaign") || "";
        fbclid = params.get("fbclid") || "";
        gclid = params.get("gclid") || "";
      }
    } catch {}

    return {
      id: e.id || e.eventId,
      eventType: e.eventType,
      timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
      productId: e.productId,
      pageUrl: e.pageUrl,
      metadata: meta,
      utm: {
        utmSource,
        utmMedium,
        utmCampaign,
        fbclid,
        gclid,
        isMetaAd: !!(fbclid || utmSource.toLowerCase().includes("meta") || utmSource.toLowerCase().includes("facebook") || utmSource.toLowerCase().includes("instagram")),
      },
    };
  });

  return json({
    visitor: {
      id: visitor.id,
      visitorId: visitor.visitorId,
      status: decryptedIdentities.length > 0 ? "identified" : visitor.status,
      firstSeenAt: visitor.firstSeenAt ? new Date(visitor.firstSeenAt).toISOString() : new Date().toISOString(),
      lastSeenAt: visitor.lastSeenAt ? new Date(visitor.lastSeenAt).toISOString() : new Date().toISOString(),
      deviceCategory: visitor.deviceCategory || clientMeta.deviceCategory || "desktop",
      deviceInfo: {
        browser: clientMeta.browser || "Chrome",
        os: clientMeta.os || "Desktop",
        screenResolution: clientMeta.screenResolution || "1920x1080",
        language: clientMeta.language || "en",
        timezone: clientMeta.timezone || "UTC",
      },
      intentScore: intent.score,
      intentTier: intent.tier,
      intentBreakdown: intent.breakdown,
      events: parsedEvents,
      identities: decryptedIdentities,
      customer: visitor.customerLinks?.[0]?.customer || null,
      auditLogs: (visitor.auditLogs || []).map((a: any) => ({
        id: a.id,
        action: a.action,
        source: a.source,
        confidence: a.confidence,
        timestamp: a.timestamp ? new Date(a.timestamp).toISOString() : new Date().toISOString(),
      })),
    },
  });
};

export default function VisitorDetailRoute() {
  const { visitor } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const isIdentified = visitor.status === "identified" || visitor.identities.length > 0;
  const customer = visitor.customer;
  const identities = visitor.identities;
  const events = visitor.events;
  const auditLogs = visitor.auditLogs;
  const deviceInfo = visitor.deviceInfo;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const primaryEmail = identities.find((i: any) => i.identityType === "email")?.value;
  const primaryPhone = identities.find((i: any) => i.identityType === "phone")?.value;

  return (
    <Page
      fullWidth
      title={
        isIdentified
          ? primaryEmail
            ? `Identified Visitor: ${primaryEmail}`
            : customer?.firstName
            ? `${customer.firstName} ${customer.lastName || ""}`
            : `Identified Visitor #${visitor.visitorId.substring(0, 8)}`
          : `Storefront Visitor #${visitor.visitorId.substring(0, 8)}`
      }
      subtitle={`Persistent Vault ID: ${visitor.visitorId} • First Seen: ${new Date(visitor.firstSeenAt).toLocaleString()}`}
      backAction={{ content: "Back to Visitors", onAction: () => navigate("/app/visitors") }}
      secondaryActions={[
        {
          content: "Back to Dashboard",
          onAction: () => navigate("/app"),
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Identity & Status Banner */}
        {isIdentified ? (
          <Banner title="🟢 Contact Identity Unmasked & Verified" tone="success">
            <p>
              This shopper has been identified through campaign UTM parameters, form autofill sniffing, or checkout sessions. All past and future clickstream events are automatically attached.
            </p>
          </Banner>
        ) : (
          <Banner title="🔵 Anonymous Active Shopper" tone="info">
            <p>
              This visitor is currently browsing anonymously. When they fill out any form, click an email campaign link, or proceed through checkout, their contact profile will automatically unmask.
            </p>
          </Banner>
        )}

        {/* Contact Info Header Card (If Identified) */}
        {isIdentified && (
          <LegacyCard sectioned>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="400" blockAlign="center">
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#008060",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 18,
                  }}
                >
                  {primaryEmail ? primaryEmail[0].toUpperCase() : "ID"}
                </div>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">
                    {primaryEmail || primaryPhone || "Identified Shopper"}
                  </Text>
                  <InlineStack gap="200">
                    {primaryEmail && (
                      <Badge tone="success">{`Email: ${primaryEmail}`}</Badge>
                    )}
                    {primaryPhone && (
                      <Badge tone="info">{`Phone: ${primaryPhone}`}</Badge>
                    )}
                    <Badge tone="subdued">{`Source: ${identities[0]?.source || "Direct Capture"}`}</Badge>
                  </InlineStack>
                </BlockStack>
              </InlineStack>

              <InlineStack gap="200">
                {primaryEmail && (
                  <Button
                    onClick={() => copyToClipboard(primaryEmail, "Email")}
                  >
                    {copiedText === "Email" ? "✓ Copied Email" : "Copy Email"}
                  </Button>
                )}
                {primaryPhone && (
                  <Button
                    variant="primary"
                    onClick={() => copyToClipboard(primaryPhone, "Phone")}
                  >
                    {copiedText === "Phone" ? "✓ Copied Phone" : "Copy Phone"}
                  </Button>
                )}
              </InlineStack>
            </InlineStack>
          </LegacyCard>
        )}

        <Layout>
          {/* Main Left Section: Chronological Clickstream Journey */}
          <Layout.Section>
            <LegacyCard title="Complete Visitor Clickstream & Journey Timeline" sectioned>
              <BlockStack gap="400">
                <Text variant="bodySm" tone="subdued" as="p">
                  Chronological trail of every page visited, ads clicked, products browsed, and cart actions taken by this visitor.
                </Text>

                <div style={{ position: "relative", paddingLeft: "24px", borderLeft: "2px solid #e1e3e5" }}>
                  {events.length === 0 ? (
                    <Text variant="bodyMd" tone="subdued" as="p">No clickstream events logged yet.</Text>
                  ) : (
                    events.map((evt: any, idx: number) => {
                      const dateStr = new Date(evt.timestamp).toLocaleString();
                      const meta = evt.metadata || {};
                      const utm = evt.utm || {};

                      let badgeTone: "success" | "attention" | "info" | undefined = undefined;
                      let badgeLabel = evt.eventType.replace(/_/g, " ").toUpperCase();

                      if (evt.eventType === "checkout_completed") {
                        badgeTone = "success";
                        badgeLabel = "ORDER COMPLETED";
                      } else if (evt.eventType === "checkout_started") {
                        badgeTone = "attention";
                        badgeLabel = "CHECKOUT STARTED";
                      } else if (evt.eventType === "product_added_to_cart") {
                        badgeTone = "attention";
                        badgeLabel = "ADDED TO CART";
                      } else if (evt.eventType === "product_viewed") {
                        badgeTone = "info";
                        badgeLabel = "PRODUCT VIEWED";
                      } else if (evt.eventType === "page_viewed") {
                        badgeLabel = "PAGE VIEW";
                      }

                      return (
                        <div key={evt.id || idx} style={{ marginBottom: "28px", position: "relative" }}>
                          {/* Dot indicator */}
                          <div
                            style={{
                              position: "absolute",
                              left: "-31px",
                              top: "4px",
                              width: "14px",
                              height: "14px",
                              borderRadius: "50%",
                              backgroundColor:
                                evt.eventType === "checkout_completed"
                                  ? "#008060"
                                  : evt.eventType === "product_added_to_cart" || evt.eventType === "checkout_started"
                                  ? "#d97706"
                                  : evt.eventType === "product_viewed"
                                  ? "#2563eb"
                                  : "#6b7280",
                              border: "2px solid #ffffff",
                              boxShadow: "0 0 0 1px #d1d5db",
                            }}
                          />

                          <BlockStack gap="150">
                            {/* Header row */}
                            <InlineStack gap="200" align="start" blockAlign="center">
                              <Badge tone={badgeTone}>{badgeLabel}</Badge>
                              <Text variant="bodySm" tone="subdued" as="span">{dateStr}</Text>
                              {utm.isMetaAd && (
                                <Badge tone="attention">🎯 META AD CAMPAIGN</Badge>
                              )}
                            </InlineStack>

                            {/* Page URL / Click Target */}
                            {evt.pageUrl && (
                              <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                <Text variant="bodySm" as="p">
                                  <strong>Page URL: </strong>
                                  <a href={evt.pageUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all" }}>
                                    {evt.pageUrl}
                                  </a>
                                </Text>
                              </div>
                            )}

                            {/* Product Details if viewed/added */}
                            {(evt.productId || meta.title) && (
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold" as="span">
                                  🛍️ Product: {meta.title || evt.productId}
                                </Text>
                                {meta.price && (
                                  <Badge tone="success">{`$${meta.price}`}</Badge>
                                )}
                              </InlineStack>
                            )}

                            {/* UTM Campaign Details */}
                            {(utm.utmCampaign || utm.utmSource || utm.fbclid) && (
                              <div style={{ background: "#fdf4ff", border: "1px solid #f0abfc", padding: "8px 12px", borderRadius: "6px" }}>
                                <InlineStack gap="300" wrap>
                                  {utm.utmSource && <Text variant="bodySm" as="span"><strong>Source:</strong> {utm.utmSource}</Text>}
                                  {utm.utmMedium && <Text variant="bodySm" as="span"><strong>Medium:</strong> {utm.utmMedium}</Text>}
                                  {utm.utmCampaign && <Text variant="bodySm" as="span"><strong>Campaign:</strong> {utm.utmCampaign}</Text>}
                                  {utm.fbclid && <Text variant="bodySm" as="span"><strong>Meta Click ID:</strong> {utm.fbclid.substring(0, 16)}...</Text>}
                                </InlineStack>
                              </div>
                            )}

                            {/* Cart Value */}
                            {meta.cartValue && (
                              <Text variant="bodySm" fontWeight="bold" as="p">
                                🛒 Cart Value: ${meta.cartValue}
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
          </Layout.Section>

          {/* Right Sidebar: Intent, Device Info, and Resolved Identifiers */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Behavioral Intent Card */}
              <LegacyCard title="Behavioral Intent Score" sectioned>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingLg" as="h3">{`${visitor.intentScore} / 100`}</Text>
                    <Badge tone={visitor.intentTier === "very_high" ? "success" : visitor.intentTier === "high" ? "attention" : undefined}>
                      {`${visitor.intentTier?.toUpperCase()} INTENT`}
                    </Badge>
                  </InlineStack>
                  <ProgressBar progress={visitor.intentScore} size="small" tone={visitor.intentScore > 60 ? "success" : "highlight"} />

                  <Divider />
                  <Text variant="headingXs" as="h4">Intent Breakdown:</Text>
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

              {/* Device & Browser Card */}
              <LegacyCard title="Device & Tech Profile" sectioned>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Device Category</Text>
                    <Badge>{visitor.deviceCategory?.toUpperCase() || "DESKTOP"}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Browser</Text>
                    <Text variant="bodySm" fontWeight="bold" as="span">{deviceInfo.browser || "Chrome"}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Operating System</Text>
                    <Text variant="bodySm" fontWeight="bold" as="span">{deviceInfo.os || "Desktop OS"}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Screen Resolution</Text>
                    <Text variant="bodySm" as="span">{deviceInfo.screenResolution || "1920x1080"}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Timezone</Text>
                    <Text variant="bodySm" as="span">{deviceInfo.timezone || "UTC"}</Text>
                  </InlineStack>
                </BlockStack>
              </LegacyCard>

              {/* Identity Graph & Unmasked Contacts */}
              <LegacyCard title="Unmasked Contact Details" sectioned>
                <BlockStack gap="300">
                  {identities.length === 0 ? (
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued" as="p">
                        No contact details unmasked yet.
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        When this user fills any field or arrives with campaign URL params, their email and phone will appear here instantly.
                      </Text>
                    </BlockStack>
                  ) : (
                    identities.map((idnt: any) => (
                      <div key={idnt.id} style={{ background: "#f0fdf4", padding: "10px", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Badge tone="info">{idnt.identityType.toUpperCase()}</Badge>
                            <Badge tone="success">{`${idnt.confidenceScore}% Match`}</Badge>
                          </InlineStack>
                          <Text variant="bodyMd" fontWeight="bold" as="p">
                            {idnt.value}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            Source: {idnt.source} • {new Date(idnt.createdAt).toLocaleDateString()}
                          </Text>
                        </BlockStack>
                      </div>
                    ))
                  )}

                  {customer && (
                    <BlockStack gap="100">
                      <Divider />
                      <Text variant="headingXs" as="h4">Linked Shopify Customer</Text>
                      <Text variant="bodySm" as="p">
                        <strong>Name:</strong> {customer.firstName} {customer.lastName}
                      </Text>
                      <Text variant="bodySm" as="p">
                        <strong>Shopify ID:</strong> {customer.shopifyCustomerId}
                      </Text>
                      <Text variant="bodySm" as="p">
                        <strong>Total Orders:</strong> {`${customer.ordersCount} ($${customer.totalSpent})`}
                      </Text>
                    </BlockStack>
                  )}
                </BlockStack>
              </LegacyCard>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}


export function ErrorBoundary() {
  const error = useRouteError() as any;
  console.error("Visitor Journey Detail Route Error:", error);

  return (
    <Page fullWidth>
      <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ background: "#fff4f4", border: "1px solid #fecaca", borderRadius: "10px", padding: "24px" }}>
          <h2 style={{ color: "#b91c1c", margin: "0 0 10px 0", fontSize: "18px", fontWeight: 700 }}>
            ⚠️ Visitor Journey Detail Loading Notice
          </h2>
          <p style={{ color: "#374151", margin: "0 0 15px 0", fontSize: "13px" }}>
            <strong>Details:</strong> {error?.message || error?.statusText || "Unexpected rendering error"}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#0f172a",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🔄 Reload Page
          </button>
          {error?.stack && (
            <details style={{ marginTop: "14px" }}>
              <summary style={{ cursor: "pointer", color: "#64748b", fontSize: "12px" }}>View Technical Stack Trace</summary>
              <pre style={{ background: "#1f2937", color: "#f9fafb", padding: "12px", borderRadius: "6px", overflowX: "auto", fontSize: "11px", marginTop: "8px" }}>
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    </Page>
  );
}
