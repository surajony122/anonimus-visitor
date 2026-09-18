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
  try {
    const [allIdentified, recentAnonymous] = await Promise.all([
      prisma.visitor.findMany({
        where: {
          OR: [
            { status: "identified" },
            { identities: { some: {} } },
            { customerLinks: { some: {} } },
          ],
        },
        include: {
          sessions: { orderBy: { startedAt: "desc" } },
          events: { orderBy: { timestamp: "desc" }, take: 50 },
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
      }),
      prisma.visitor.findMany({
        where: {
          status: "anonymous",
          identities: { none: {} },
          customerLinks: { none: {} },
        },
        include: {
          sessions: { orderBy: { startedAt: "desc" } },
          events: { orderBy: { timestamp: "desc" }, take: 50 },
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 1000,
      }),
    ]);

    const visitorMap = new Map();
    for (const v of allIdentified) visitorMap.set(v.id, v);
    for (const v of recentAnonymous) {
      if (!visitorMap.has(v.id)) visitorMap.set(v.id, v);
    }
    visitors = Array.from(visitorMap.values()).sort(
      (a: any, b: any) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );
  } catch (dbErr) {
    console.warn("Visitors DB query fallback:", dbErr);
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

  return json({ visitors: enriched });
};

export default function VisitorsList() {
  const { visitors } = useLoaderData<typeof loader>();
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
      revalidator.revalidate();
      setLastRefreshedAt(new Date().toLocaleTimeString());
    }, 5000);
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
          content: autoRefresh ? "🟢 Auto-Refresh (15s)" : "⏸️ Auto-Refresh: Off",
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
              No visitor records match this filter.
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
                  onClick={() => setSelectedVisitor(v)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(220px, 1.6fr) 150px 170px 120px 140px 90px 110px",
                    gap: "12px",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                    transition: "background 0.12s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Visitor / Lead */}
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: isIdentified ? "#0F8A5F" : v.intentScore >= 60 ? "#d97706" : "#94a3b8",
                      flex: "none",
                    }}></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13px", color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {displayName}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.visitorId.substring(0, 16)}...
                      </div>
                    </div>
                  </div>

                  {/* Device & OS */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "12px", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.browser} on {v.os}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "monospace" }}>
                      {v.screenResolution}
                    </div>
                  </div>

                  {/* Captured Contact */}
                  <div style={{ minWidth: 0 }}>
                    {v.primaryEmail ? (
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0F8A5F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.primaryEmail}
                      </div>
                    ) : (
                      <span style={{ color: "#94a3b8", fontSize: "11.5px" }}>Anonymous</span>
                    )}
                    {v.primaryPhone && (
                      <div style={{ fontSize: "11px", color: "#2563eb", fontFamily: "monospace" }}>
                        {v.primaryPhone}
                      </div>
                    )}
                  </div>

                  {/* Intent Score */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 7px",
                      background: v.intentScore > 60 ? "#dcfce7" : "#e0e7ff",
                      color: v.intentScore > 60 ? "#15803d" : "#3730a3",
                      borderRadius: "4px",
                      fontSize: "11.5px",
                      fontWeight: 700,
                      fontFamily: "monospace",
                    }}>
                      {`${v.intentScore}/100`}
                    </span>
                    <span style={{ fontSize: "11px", color: "#64748b", textTransform: "capitalize" }}>
                      {v.intentTier.replace("_", " ")}
                    </span>
                  </div>

                  {/* Browsing & Cart */}
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                      {v.productsViewedCount} viewed
                    </div>
                    <div style={{ fontSize: "11px", color: v.cartEventsCount > 0 ? "#d97706" : "#94a3b8" }}>
                      {v.cartEventsCount > 0 ? `${v.cartEventsCount} in cart ($${v.cartValue})` : "No cart items"}
                    </div>
                  </div>

                  {/* Last Seen */}
                  <div style={{ fontSize: "11.5px", color: "#64748b", fontFamily: "monospace" }}>
                    {new Date(v.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>

                  {/* Action Button: Opens Journey Popup */}
                  <div style={{ textAlign: "right" }}>
                    <button
                      style={{
                        padding: "5px 10px",
                        background: "#2563eb",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVisitor(v);
                      }}
                    >
                      View Journey →
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#faf9f6", fontSize: "11.5px", color: "#64748b" }}>
            <span>Showing {filtered.length} active visitor records</span>
            <span style={{ fontFamily: "monospace" }}>Live Auto-Refresh 5s</span>
          </div>
        </div>
      </BlockStack>

      {/* POPUP MODAL: Interactive Journey & Lore Details */}
      {selectedVisitor && (
        <Modal
          open={Boolean(selectedVisitor)}
          onClose={() => setSelectedVisitor(null)}
          title={`Visitor Journey & Profile: ${selectedVisitor.visitorId}`}
          primaryAction={{
            content: "Close Details",
            onAction: () => setSelectedVisitor(null),
          }}
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Top Banner */}
              {selectedVisitor.status === "identified" || selectedVisitor.primaryEmail || selectedVisitor.primaryPhone ? (
                <Banner title="🟢 Contact Identity Unmasked & Verified" tone="success">
                  <p>
                    This shopper has been identified through campaign parameters, form autofill sniffing, or checkout sessions.
                  </p>
                </Banner>
              ) : (
                <Banner title="🔵 Anonymous Active Shopper" tone="info">
                  <p>
                    This visitor is currently browsing anonymously. When they type their email/phone or click a campaign ad, their identity unmasks instantly.
                  </p>
                </Banner>
              )}

              {/* Unmasked Contact Profile Card */}
              {(selectedVisitor.primaryEmail || selectedVisitor.primaryPhone) && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px 16px" }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h3">Unmasked Contact Information</Text>
                      <InlineStack gap="300">
                        {selectedVisitor.primaryEmail && (
                          <Badge tone="success">{`Email: ${selectedVisitor.primaryEmail}`}</Badge>
                        )}
                        {selectedVisitor.primaryPhone && (
                          <Badge tone="info">{`Phone: ${selectedVisitor.primaryPhone}`}</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="200">
                      {selectedVisitor.primaryEmail && (
                        <Button size="slim" onClick={() => copyToClipboard(selectedVisitor.primaryEmail, "Email")}>
                          {copiedText === "Email" ? "✓ Copied" : "Copy Email"}
                        </Button>
                      )}
                      {selectedVisitor.primaryPhone && (
                        <Button size="slim" variant="primary" onClick={() => copyToClipboard(selectedVisitor.primaryPhone, "Phone")}>
                          {copiedText === "Phone" ? "✓ Copied" : "Copy Phone"}
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>
                </div>
              )}

              {/* 2-Column Summary: Behavioral Intent + Device Profile */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                {/* Behavioral Intent */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px" }}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="headingSm" as="h4">Intent Score</Text>
                      <Badge tone={selectedVisitor.intentTier === "very_high" ? "success" : selectedVisitor.intentTier === "high" ? "attention" : undefined}>
                        {`${selectedVisitor.intentScore}/100 • ${selectedVisitor.intentTier.toUpperCase()}`}
                      </Badge>
                    </InlineStack>
                    <ProgressBar progress={selectedVisitor.intentScore} size="small" tone={selectedVisitor.intentScore > 60 ? "success" : "highlight"} />
                    <Divider />
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Products Viewed</Text>
                      <Text variant="bodySm" fontWeight="bold" as="span">{selectedVisitor.productsViewedCount}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Cart Additions</Text>
                      <Text variant="bodySm" fontWeight="bold" as="span">{`${selectedVisitor.cartEventsCount} ($${selectedVisitor.cartValue})`}</Text>
                    </InlineStack>
                  </BlockStack>
                </div>

                {/* Device & Hardware */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px" }}>
                  <BlockStack gap="150">
                    <Text variant="headingSm" as="h4">Device Profile</Text>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Device</Text>
                      <Badge>{selectedVisitor.deviceCategory.toUpperCase()}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Browser</Text>
                      <Text variant="bodySm" fontWeight="bold" as="span">{selectedVisitor.browser}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Operating System</Text>
                      <Text variant="bodySm" fontWeight="bold" as="span">{selectedVisitor.os}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Resolution</Text>
                      <Text variant="bodySm" as="span" style={{ fontFamily: "monospace" }}>{selectedVisitor.screenResolution}</Text>
                    </InlineStack>
                  </BlockStack>
                </div>
              </div>

              {/* Chronological Event Timeline */}
              <div style={{ marginTop: "10px" }}>
                <Text variant="headingSm" as="h3">Chronological Clickstream Timeline</Text>
                <div style={{ position: "relative", paddingLeft: "24px", borderLeft: "2px solid #e2e8f0", marginTop: "14px" }}>
                  {(!selectedVisitor.events || selectedVisitor.events.length === 0) ? (
                    <Text variant="bodyMd" tone="subdued" as="p">No clickstream events recorded yet.</Text>
                  ) : (
                    selectedVisitor.events.map((evt: any, idx: number) => {
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
                        <div key={evt.id || idx} style={{ marginBottom: "22px", position: "relative" }}>
                          {/* Timeline dot */}
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
                              boxShadow: "0 0 0 1px #cbd5e1",
                            }}
                          />

                          <BlockStack gap="100">
                            <InlineStack gap="200" align="start" blockAlign="center">
                              <Badge tone={badgeTone}>{badgeLabel}</Badge>
                              <Text variant="bodySm" tone="subdued" as="span">{dateStr}</Text>
                              {utm.isMetaAd && (
                                <Badge tone="attention">🎯 META AD CAMPAIGN</Badge>
                              )}
                            </InlineStack>

                            {/* Page URL / Click Target */}
                            {evt.pageUrl && (
                              <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                <Text variant="bodySm" as="p">
                                  <strong>URL: </strong>
                                  <a href={evt.pageUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all" }}>
                                    {evt.pageUrl}
                                  </a>
                                </Text>
                              </div>
                            )}

                            {/* Product Details */}
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
                              <div style={{ background: "#fdf4ff", border: "1px solid #f0abfc", padding: "6px 10px", borderRadius: "6px" }}>
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
              </div>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
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
