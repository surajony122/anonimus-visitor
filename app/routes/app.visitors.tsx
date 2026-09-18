import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator, useRouteError } from "@remix-run/react";
import React, { useState, useEffect } from "react";
import {
  Page,
  Badge,
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Text,
  ButtonGroup,
  Modal,
  Divider,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { decryptValue } from "../services/normalizer.server";
import { authenticate } from "../shopify.server";
import { Icon } from "../components/Icon";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  let visitors: any[] = [];
  let totalCount = 0;
  try {
    const [fetchVisitors, realCount] = await Promise.all([
      prisma.visitor.findMany({
        take: 300,
        include: {
          sessions: { orderBy: { startedAt: "desc" }, take: 5 },
          events: { orderBy: { timestamp: "desc" }, take: 15 },
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
      }).catch(() => []),
      prisma.visitor.count().catch(() => 0),
    ]);

    visitors = fetchVisitors;
    totalCount = realCount || visitors.length;
  } catch (dbErr) {
    console.warn("Visitors DB query fallback:", dbErr);
    visitors = [];
    totalCount = 0;
  }

  const enriched = visitors.map((v) => {
    let clientMeta: any = {};
    try {
      if (v.metadata) {
        clientMeta = typeof v.metadata === "string" ? JSON.parse(v.metadata) : v.metadata;
      }
    } catch {}

    const pViews = v.events.filter((e: any) => e.eventType === "product_viewed").length;
    const uniqueProductIds = new Set(
      v.events
        .filter((e: any) => e.eventType === "product_viewed" && e.productId)
        .map((e: any) => e.productId!)
    );
    const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
    const cViews = v.events.filter((e: any) => e.eventType === "collection_viewed").length;
    const searches = v.events.filter((e: any) => e.eventType === "search_submitted").length;
    const addToCart = v.events.filter((e: any) => e.eventType === "product_added_to_cart").length;
    const cartViews = v.events.filter((e: any) => e.eventType === "cart_viewed").length;
    const checkouts = v.events.filter((e: any) => e.eventType === "checkout_started").length;
    const checkoutsCompleted = v.events.filter((e: any) => e.eventType === "checkout_completed").length;

    let cartVal = 0;
    v.events.forEach((e: any) => {
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
      sessionsCount: v.sessions?.length || 1,
    });

    const emailId = v.identities.find((i: any) => i.identityType === "email");
    const phoneId = v.identities.find((i: any) => i.identityType === "phone");
    const customer = v.customerLinks?.[0]?.customer || null;

    let rawDecryptedEmail = customer?.emailReference || null;
    const encEmail = emailId?.identityValueEncrypted || emailId?.encryptedValue;
    if (encEmail) {
      try {
        rawDecryptedEmail = decryptValue(encEmail);
      } catch {}
    }

    let rawDecryptedPhone = customer?.phoneReference || null;
    const encPhone = phoneId?.identityValueEncrypted || phoneId?.encryptedValue;
    if (encPhone) {
      try {
        rawDecryptedPhone = decryptValue(encPhone);
      } catch {}
    }

    const decryptedIdentities = (v.identities || []).map((i: any) => {
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

    const parsedEvents = (v.events || []).map((e: any) => {
      let meta: any = {};
      try {
        if (e.metadata) meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
      } catch {}

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

    return {
      id: v.id,
      visitorId: v.visitorId,
      status: decryptedIdentities.length > 0 ? "identified" : v.status,
      firstSeenAt: v.firstSeenAt ? new Date(v.firstSeenAt).toISOString() : new Date().toISOString(),
      lastSeenAt: v.lastSeenAt ? new Date(v.lastSeenAt).toISOString() : new Date().toISOString(),
      deviceCategory: v.deviceCategory || clientMeta.deviceCategory || "desktop",
      browser: clientMeta.browser || "Chrome",
      os: clientMeta.os || "Desktop OS",
      screenResolution: clientMeta.screenResolution || "1920x1080",
      language: clientMeta.language || "en",
      timezone: clientMeta.timezone || "UTC",
      sessionsCount: v.sessions?.length || 1,
      productsViewedCount: pViews,
      cartEventsCount: addToCart,
      cartValue: cartVal,
      intentScore: intent.score,
      intentTier: intent.tier,
      intentBreakdown: intent.breakdown,
      primaryEmail: rawDecryptedEmail,
      primaryPhone: rawDecryptedPhone,
      identities: decryptedIdentities,
      events: parsedEvents,
      customer: customer
        ? {
            id: customer.shopifyCustomerId,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.emailReference,
            phone: customer.phoneReference,
          }
        : null,
    };
  });

  return json({ visitors: enriched, totalCount });
};

export default function VisitorsList() {
  const data = useLoaderData<typeof loader>();
  const visitors = data?.visitors || [];
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";

  const [statusFilter, setStatusFilter] = useState("all");
  const [intentFilter, setIntentFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("just now");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const handleManualRefresh = () => {
    revalidator.revalidate();
    setLastRefreshedAt(new Date().toLocaleTimeString());
  };

  useEffect(() => {
    if (!autoRefresh || selectedVisitor !== null) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      revalidator.revalidate();
      setLastRefreshedAt(new Date().toLocaleTimeString());
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedVisitor, revalidator]);

  const [timeFilter, setTimeFilter] = useState("all");

  let filtered = visitors;
  if (statusFilter === "identified") {
    filtered = filtered.filter((v: any) => v.status === "identified" || Boolean(v.primaryEmail) || Boolean(v.primaryPhone) || Boolean(v.customer));
  } else if (statusFilter === "anonymous") {
    filtered = filtered.filter((v: any) => v.status === "anonymous" && !v.primaryEmail && !v.primaryPhone && !v.customer);
  }

  if (intentFilter !== "all") {
    filtered = filtered.filter((v: any) => v.intentTier === intentFilter);
  }

  if (timeFilter !== "all") {
    const now = Date.now();
    filtered = filtered.filter((v: any) => {
      const vTime = new Date(v.lastSeenAt).getTime();
      if (timeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return vTime >= todayStart.getTime();
      }
      if (timeFilter === "24h") return now - vTime <= 24 * 3600 * 1000;
      if (timeFilter === "7d") return now - vTime <= 7 * 24 * 3600 * 1000;
      return true;
    });
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (v: any) =>
        v.visitorId.toLowerCase().includes(q) ||
        (v.primaryEmail && v.primaryEmail.toLowerCase().includes(q)) ||
        (v.primaryPhone && v.primaryPhone.includes(q)) ||
        (v.browser && v.browser.toLowerCase().includes(q)) ||
        (v.os && v.os.toLowerCase().includes(q)) ||
        (v.customer?.firstName && v.customer.firstName.toLowerCase().includes(q))
    );
  }

  return (
    <Page
      fullWidth
      title={
        <InlineStack gap="200" align="center">
          <Icon name="ic-users" size={22} color="var(--accent)" />
          <span>Storefront Visitors</span>
        </InlineStack>
      }
      subtitle={`Displaying ${filtered.length} active shoppers tracked across the store`}
      secondaryActions={[
        {
          content: autoRefresh ? "🟢 Live Auto-Refresh (15s)" : "⏸️ Auto-Refresh: Off",
          onAction: () => setAutoRefresh(!autoRefresh),
        },
        {
          content: isRefreshing ? "Refreshing..." : "🔄 Refresh Now",
          loading: isRefreshing,
          onAction: handleManualRefresh,
        },
        {
          content: "Back to Overview",
          onAction: () => navigate("/app"),
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Filters */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <TextField
              label=""
              placeholder="Search visitor ID, email, phone, OS, browser..."
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
            />
          </div>

          <ButtonGroup variant="segmented">
            <Button pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</Button>
            <Button pressed={statusFilter === "identified"} onClick={() => setStatusFilter("identified")}>Identified</Button>
            <Button pressed={statusFilter === "anonymous"} onClick={() => setStatusFilter("anonymous")}>Anonymous</Button>
          </ButtonGroup>

          <div style={{ width: "160px" }}>
            <Select
              label=""
              options={[
                { label: "All Intent Tiers", value: "all" },
                { label: "Very High Intent", value: "very_high" },
                { label: "High Intent", value: "high" },
                { label: "Medium Intent", value: "medium" },
                { label: "Low Intent", value: "low" },
              ]}
              value={intentFilter}
              onChange={(val) => setIntentFilter(val)}
            />
          </div>

          <div style={{ width: "140px" }}>
            <Select
              label=""
              options={[
                { label: "All Time", value: "all" },
                { label: "Today", value: "today" },
                { label: "Last 24 Hours", value: "24h" },
                { label: "Last 7 Days", value: "7d" },
              ]}
              value={timeFilter}
              onChange={(val) => setTimeFilter(val)}
            />
          </div>
        </div>

        {/* Uniform Table matching Main Dashboard */}
        <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1.6fr) 150px 170px 120px 140px 90px 110px",
            gap: "12px",
            padding: "10px 16px",
            background: "#faf9f6",
            borderBottom: "1px solid #e2e8f0",
            fontSize: "11px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
            fontWeight: 600,
          }}>
            <div>Visitor / Lead</div>
            <div>Device &amp; OS</div>
            <div>Captured Contact</div>
            <div>Intent Score</div>
            <div>Browsing &amp; Cart</div>
            <div>Last Seen</div>
            <div style={{ textAlign: "right" }}>Action</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "48px 16px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No visitor records match this filter. Use the Simulator to pump live test traffic.
            </div>
          ) : (
            filtered.map((v: any) => {
              const isIdentified = v.status === "identified" || v.primaryEmail || v.primaryPhone;
              const displayName = v.customer?.firstName
                ? `${v.customer.firstName} ${v.customer.lastName || ""}`
                : isIdentified && v.primaryEmail
                ? v.primaryEmail
                : `Anonymous #${v.visitorId.substring(0, 8)}`;

              return (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(220px, 1.6fr) 150px 170px 120px 140px 90px 110px",
                    gap: "12px",
                    padding: "12px 16px",
                    alignItems: "center",
                    borderBottom: "1px solid #f1f5f9",
                    background: "#ffffff",
                    fontSize: "12px",
                  }}
                >
                  {/* Lead Info */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <div style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: isIdentified ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "#f1f5f9",
                      color: isIdentified ? "#ffffff" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "12px",
                      flex: "none",
                    }}>
                      {isIdentified ? "👤" : "🕶️"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {displayName}
                      </div>
                      <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                        ID: {v.visitorId.substring(0, 8)}...
                      </div>
                    </div>
                  </div>

                  {/* Device & OS */}
                  <div>
                    <div style={{ fontWeight: 500, color: "#334155" }}>
                      {v.deviceCategory === "mobile" ? "📱 Mobile" : "💻 Desktop"}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {v.os} • {v.browser}
                    </div>
                  </div>

                  {/* Captured Contact */}
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {v.primaryEmail ? (
                      <div style={{ color: "#059669", fontWeight: 600, fontSize: "11.5px" }}>
                        ✉️ {v.primaryEmail}
                      </div>
                    ) : v.primaryPhone ? (
                      <div style={{ color: "#059669", fontWeight: 600, fontSize: "11.5px" }}>
                        📞 {v.primaryPhone}
                      </div>
                    ) : (
                      <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "11.5px" }}>
                        Unidentified
                      </span>
                    )}
                  </div>

                  {/* Intent Score */}
                  <div>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      background: v.intentScore >= 70 ? "#dcfce7" : v.intentScore >= 40 ? "#fef3c7" : "#f1f5f9",
                      color: v.intentScore >= 70 ? "#166534" : v.intentScore >= 40 ? "#92400e" : "#475569",
                    }}>
                      {v.intentScore}/100 ({v.intentTier})
                    </span>
                  </div>

                  {/* Browsing & Cart */}
                  <div>
                    <div style={{ fontWeight: 600, color: "#334155" }}>
                      {v.productsViewedCount} PDPs • {v.cartEventsCount} Carts
                    </div>
                    {v.cartValue > 0 && (
                      <div style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 700 }}>
                        ₹{v.cartValue.toLocaleString()} in bag
                      </div>
                    )}
                  </div>

                  {/* Last Seen */}
                  <div style={{ color: "#64748b", fontSize: "11px" }}>
                    {new Date(v.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>

                  {/* Action */}
                  <div style={{ textAlign: "right" }}>
                    <Button size="micro" onClick={() => setSelectedVisitor(v)}>
                      Inspect Journey
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal: Visitor Clickstream Journey */}
        {selectedVisitor && (
          <Modal
            open={!!selectedVisitor}
            onClose={() => setSelectedVisitor(null)}
            title={`Shopper Journey: ${selectedVisitor.visitorId}`}
            primaryAction={{
              content: "Close",
              onAction: () => setSelectedVisitor(null),
            }}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <InlineStack align="space-between">
                    <div>
                      <Text variant="headingSm" as="h4">Device Profile</Text>
                      <Text variant="bodySm" as="p" tone="subdued">
                        {selectedVisitor.os} • {selectedVisitor.browser} ({selectedVisitor.screenResolution})
                      </Text>
                    </div>
                    <Badge tone={selectedVisitor.status === "identified" ? "success" : "info"}>
                      {selectedVisitor.status}
                    </Badge>
                  </InlineStack>
                </div>

                <div>
                  <Text variant="headingSm" as="h4">Clickstream Timeline ({selectedVisitor.events.length} events)</Text>
                  <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
                    {selectedVisitor.events.map((evt: any, idx: number) => (
                      <div key={idx} style={{ padding: "10px 14px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <Badge tone="info">{evt.eventType}</Badge>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                        </div>
                        {evt.pageUrl && <div style={{ fontSize: "11.5px", color: "#64748b", wordBreak: "break-all" }}>{evt.pageUrl}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError() as any;
  console.error("Storefront Visitors Route Error:", error);

  return (
    <Page fullWidth>
      <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ background: "#fff4f4", border: "1px solid #fecaca", borderRadius: "10px", padding: "24px" }}>
          <h2 style={{ color: "#b91c1c", margin: "0 0 10px 0", fontSize: "18px", fontWeight: 700 }}>
            ⚠️ Storefront Visitors Loading Notice
          </h2>
          <p style={{ color: "#374151", margin: "0 0 15px 0", fontSize: "13px" }}>
            <strong>Details:</strong> {error?.message || error?.statusText || "Database reconnecting..."}
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
        </div>
      </div>
    </Page>
  );
}
