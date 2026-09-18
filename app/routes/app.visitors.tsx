import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator, useRouteError, useSearchParams } from "@remix-run/react";
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
} from "@shopify/polaris";
import prisma from "../db.server";
import { appCache } from "../services/cache.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { decryptValue } from "../services/normalizer.server";
import { authenticate } from "../shopify.server";
import { Icon } from "../components/Icon";
import { SkeletonTable } from "../components/SkeletonLoader";

function safeIso(val: any, fallback = new Date().toISOString()): string {
  if (!val) return fallback;
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallback : d.toISOString();
  } catch {
    return fallback;
  }
}

function safeDecrypt(val?: string | null): string {
  if (!val) return "";
  try {
    return decryptValue(val);
  } catch {
    return "[Protected Value]";
  }
}

function safeJson(val: any): any {
  if (!val) return {};
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isForceRefresh = url.searchParams.get("refresh") === "true";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)));
  const statusParam = url.searchParams.get("status") || "all";
  const timeParam = url.searchParams.get("time") || "all";
  const intentParam = url.searchParams.get("intent") || "all";
  const queryParam = (url.searchParams.get("q") || "").trim();

  let shopDomain = "theunniyarcha.myshopify.com";

  try {
    const { session } = await authenticate.admin(request);
    if (session?.shop) shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn("Visitors loader auth notice:", err);
  }

  const cacheKey = `visitors_${shopDomain}_p${page}_l${limit}_s${statusParam}_t${timeParam}_i${intentParam}_q${queryParam}`;
  if (!isForceRefresh) {
    const cached = appCache.get(cacheKey);
    if (cached) {
      return json(cached);
    }
  }

  try {
    const where: any = {};

    if (statusParam === "identified") {
      where.status = "identified";
    } else if (statusParam === "anonymous") {
      where.status = "anonymous";
    }

    if (timeParam === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      where.lastSeenAt = { gte: todayStart };
    } else if (timeParam === "24h") {
      where.lastSeenAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };
    } else if (timeParam === "7d") {
      where.lastSeenAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
    }

    if (queryParam) {
      where.visitorId = { contains: queryParam, mode: "insensitive" };
    }

    const [realCount, fetchVisitors] = await Promise.all([
      prisma.visitor.count({ where }).catch(() => 0),
      prisma.visitor.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          visitorId: true,
          status: true,
          firstSeenAt: true,
          lastSeenAt: true,
          deviceCategory: true,
          metadata: true,
          identities: {
            select: {
              id: true,
              identityType: true,
              identityValueEncrypted: true,
              source: true,
              confidenceScore: true,
              createdAt: true,
            },
          },
          customerLinks: {
            take: 1,
            select: {
              customer: {
                select: {
                  shopifyCustomerId: true,
                  firstName: true,
                  lastName: true,
                  emailReference: true,
                  phoneReference: true,
                },
              },
            },
          },
          events: {
            take: 15,
            orderBy: { timestamp: "desc" },
            select: {
              id: true,
              eventType: true,
              timestamp: true,
              productId: true,
              pageUrl: true,
              metadata: true,
            },
          },
          sessions: {
            take: 3,
            select: { id: true, startedAt: true },
          },
        },
      }).catch(() => []),
    ]);

    const enriched = fetchVisitors.map((v: any) => {
      try {
        const clientMeta = safeJson(v.metadata);
        const vEvents = Array.isArray(v.events) ? v.events : [];
        const vIdentities = Array.isArray(v.identities) ? v.identities : [];
        const vSessions = Array.isArray(v.sessions) ? v.sessions : [];

        const pViews = vEvents.filter((e: any) => e.eventType === "product_viewed").length;
        const uniqueProductIds = new Set(
          vEvents
            .filter((e: any) => e.eventType === "product_viewed" && e.productId)
            .map((e: any) => e.productId!)
        );
        const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
        const cViews = vEvents.filter((e: any) => e.eventType === "collection_viewed").length;
        const searches = vEvents.filter((e: any) => e.eventType === "search_submitted").length;
        const addToCart = vEvents.filter((e: any) => e.eventType === "product_added_to_cart").length;
        const cartViews = vEvents.filter((e: any) => e.eventType === "cart_viewed").length;
        const checkouts = vEvents.filter((e: any) => e.eventType === "checkout_started").length;
        const checkoutsCompleted = vEvents.filter((e: any) => e.eventType === "checkout_completed").length;

        let cartVal = 0;
        vEvents.forEach((e: any) => {
          if (e.metadata) {
            const meta = safeJson(e.metadata);
            if (meta.cartValue || meta.price) {
              cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
            }
          }
        });

        let intent = { score: 10, tier: "low" as const, breakdown: { productEngagement: 0, cartActivity: 0, checkoutProgress: 0, sessionDepth: 0 } };
        try {
          intent = calculateIntentScore({
            productViewsCount: pViews,
            repeatProductViews: repeatViews,
            collectionViewsCount: cViews,
            searchesCount: searches,
            addedToCartCount: addToCart,
            cartViewedCount: cartViews,
            cartValue: cartVal,
            checkoutStartedCount: checkouts,
            checkoutCompletedCount: checkoutsCompleted,
            sessionsCount: vSessions.length || 1,
          });
        } catch {}

        const emailId = vIdentities.find((i: any) => i.identityType === "email");
        const phoneId = vIdentities.find((i: any) => i.identityType === "phone");
        const customer = v.customerLinks?.[0]?.customer || null;

        let rawDecryptedEmail = customer?.emailReference || null;
        if (emailId?.identityValueEncrypted) {
          rawDecryptedEmail = safeDecrypt(emailId.identityValueEncrypted);
        }

        let rawDecryptedPhone = customer?.phoneReference || null;
        if (phoneId?.identityValueEncrypted) {
          rawDecryptedPhone = safeDecrypt(phoneId.identityValueEncrypted);
        }

        const decryptedIdentities = vIdentities.map((i: any) => ({
          id: i.id,
          identityType: i.identityType,
          value: i.identityValueEncrypted ? safeDecrypt(i.identityValueEncrypted) : "",
          source: i.source,
          confidenceScore: i.confidenceScore,
          createdAt: safeIso(i.createdAt),
        }));

        const parsedEvents = vEvents.map((e: any) => {
          const meta = safeJson(e.metadata);
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
            id: e.id,
            eventType: e.eventType,
            timestamp: safeIso(e.timestamp),
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
          status: decryptedIdentities.length > 0 || rawDecryptedEmail || rawDecryptedPhone ? "identified" : v.status || "anonymous",
          firstSeenAt: safeIso(v.firstSeenAt),
          lastSeenAt: safeIso(v.lastSeenAt),
          deviceCategory: v.deviceCategory || clientMeta.deviceCategory || "desktop",
          browser: clientMeta.browser || "Chrome",
          os: clientMeta.os || "Desktop OS",
          screenResolution: clientMeta.screenResolution || "1920x1080",
          language: clientMeta.language || "en",
          timezone: clientMeta.timezone || "UTC",
          sessionsCount: vSessions.length || 1,
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
      } catch (e) {
        return {
          id: v.id,
          visitorId: v.visitorId,
          status: "anonymous",
          firstSeenAt: safeIso(v.firstSeenAt),
          lastSeenAt: safeIso(v.lastSeenAt),
          deviceCategory: "desktop",
          browser: "Chrome",
          os: "Desktop OS",
          screenResolution: "1920x1080",
          language: "en",
          timezone: "UTC",
          sessionsCount: 1,
          productsViewedCount: 0,
          cartEventsCount: 0,
          cartValue: 0,
          intentScore: 10,
          intentTier: "low",
          intentBreakdown: { productEngagement: 0, cartActivity: 0, checkoutProgress: 0, sessionDepth: 0 },
          primaryEmail: null,
          primaryPhone: null,
          identities: [],
          events: [],
          customer: null,
        };
      }
    });

    let finalVisitors = enriched;
    if (intentParam !== "all") {
      finalVisitors = finalVisitors.filter((v) => v.intentTier === intentParam);
    }

    const totalCount = realCount || finalVisitors.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const result = {
      visitors: finalVisitors,
      totalCount,
      page,
      limit,
      totalPages,
      filters: { status: statusParam, time: timeParam, intent: intentParam, q: queryParam },
    };

    appCache.set(cacheKey, result, 15 * 1000);
    return json(result);
  } catch (err) {
    console.error("Visitors loader error:", err);
    return json({
      visitors: [],
      totalCount: 0,
      page: 1,
      limit: 50,
      totalPages: 1,
      filters: { status: "all", time: "all", intent: "all", q: "" },
    });
  }
};

export default function VisitorsList() {
  const data = useLoaderData<typeof loader>();
  const visitors = data?.visitors || [];
  const totalCount = data?.totalCount || 0;
  const page = data?.page || 1;
  const totalPages = data?.totalPages || 1;
  const limit = data?.limit || 50;
  const filters = data?.filters || { status: "all", time: "all", intent: "all", q: "" };

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";
  const [isPending, startTransition] = React.useTransition();

  const [searchQuery, setSearchQuery] = useState(filters.q || "");
  const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("just now");

  const updateFilters = (newParams: Record<string, string>) => {
    startTransition(() => {
      const sp = new URLSearchParams(searchParams);
      Object.entries(newParams).forEach(([k, v]) => {
        if (!v || v === "all" || (k === "page" && v === "1")) {
          sp.delete(k);
        } else {
          sp.set(k, v);
        }
      });
      navigate(`?${sp.toString()}`);
    });
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

  const handleExportVisitorsCSV = () => {
    if (!visitors || visitors.length === 0) return;
    const headers = ["Visitor ID", "Status", "Intent Score", "Intent Tier", "Email", "Phone", "Device", "OS", "Browser", "Cart Value", "Sessions", "First Seen", "Last Seen"];
    const rows = visitors.map((v: any) => [
      v.visitorId,
      v.status || (v.primaryEmail || v.primaryPhone ? "identified" : "anonymous"),
      v.intentScore || 0,
      v.intentTier || "low",
      v.primaryEmail || "Anonymous",
      v.primaryPhone || "Anonymous",
      v.deviceCategory || "Mobile",
      v.os || "Device OS",
      v.browser || "Browser",
      v.cartValue || 0,
      v.sessionsCount || 1,
      safeIso(v.firstSeenAt),
      safeIso(v.lastSeenAt),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(r => r.map(c => `"${String(c !== null && c !== undefined ? c : '').replace(/"/g, '""')}"`).join(","))
    ].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `nitro_visitors_${filters.status}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startIdx = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, totalCount);

  return (
    <Page
      fullWidth
      title={
        <InlineStack gap="200" align="center">
          <Icon name="ic-users" size={22} color="var(--accent)" />
          <span>Storefront Visitors</span>
        </InlineStack>
      }
      subtitle={`Displaying ${startIdx}-${endIdx} of ${totalCount.toLocaleString()} shoppers tracked`}
      secondaryActions={[
        {
          content: "📥 Export Page (CSV)",
          onAction: handleExportVisitorsCSV,
        },
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
        {/* Filters Bar */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <TextField
              label=""
              placeholder="Search visitor ID, email, phone, OS..."
              value={searchQuery}
              onChange={(val) => {
                setSearchQuery(val);
                updateFilters({ q: val, page: "1" });
              }}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => {
                setSearchQuery("");
                updateFilters({ q: "", page: "1" });
              }}
            />
          </div>

          <ButtonGroup variant="segmented">
            <Button pressed={filters.status === "all"} onClick={() => updateFilters({ status: "all", page: "1" })}>All</Button>
            <Button pressed={filters.status === "identified"} onClick={() => updateFilters({ status: "identified", page: "1" })}>Identified</Button>
            <Button pressed={filters.status === "anonymous"} onClick={() => updateFilters({ status: "anonymous", page: "1" })}>Anonymous</Button>
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
              value={filters.intent}
              onChange={(val) => updateFilters({ intent: val, page: "1" })}
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
              value={filters.time}
              onChange={(val) => updateFilters({ time: val, page: "1" })}
            />
          </div>
        </div>

        {/* Table & Pagination */}
        {isPending || isRefreshing ? (
          <SkeletonTable
            rows={8}
            columns={7}
            columnTemplate="minmax(220px, 1.6fr) 150px 170px 120px 140px 90px 110px"
          />
        ) : (
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
              <div>Device & OS</div>
              <div>Captured Contact</div>
              <div>Intent Score</div>
              <div>Browsing & Cart</div>
              <div>Last Seen</div>
              <div style={{ textAlign: "right" }}>Action</div>
            </div>

            {visitors.length === 0 ? (
              <div style={{ padding: "48px 16px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                No visitor records match this filter in the database.
              </div>
            ) : (
              visitors.map((v: any) => {
                const isIdentified = v.status === "identified" || v.primaryEmail || v.primaryPhone;
                const displayName = v.customer?.firstName
                  ? `${v.customer.firstName} ${v.customer.lastName || ""}`
                  : isIdentified && v.primaryEmail
                  ? v.primaryEmail
                  : `Anonymous #${(v.visitorId || "visitor").substring(0, 8)}`;

                return (
                  <div
                    key={v.id || v.visitorId}
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
                          ID: {(v.visitorId || "").substring(0, 8)}...
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
                      {(() => {
                        try {
                          return new Date(v.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        } catch {
                          return "recently";
                        }
                      })()}
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                background: "#fafaf9",
                borderTop: "1px solid #e2e8f0",
                fontSize: "12px",
                color: "#64748b",
                flexWrap: "wrap",
                gap: "8px",
              }}>
                <div>
                  Showing <strong>{startIdx}</strong> - <strong>{endIdx}</strong> of <strong>{totalCount.toLocaleString()}</strong> shoppers
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    onClick={() => updateFilters({ page: String(page - 1) })}
                    disabled={page <= 1}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: page <= 1 ? "#f1f5f9" : "#ffffff",
                      color: page <= 1 ? "#94a3b8" : "#334155",
                      cursor: page <= 1 ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      fontSize: "12px",
                    }}
                  >
                    ◀ Previous 50
                  </button>
                  <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "12px" }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => updateFilters({ page: String(page + 1) })}
                    disabled={page >= totalPages}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: page >= totalPages ? "#f1f5f9" : "#ffffff",
                      color: page >= totalPages ? "#94a3b8" : "#334155",
                      cursor: page >= totalPages ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      fontSize: "12px",
                    }}
                  >
                    Next 50 ▶
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
                  <Text variant="headingSm" as="h4">Clickstream Timeline ({(selectedVisitor.events || []).length} events)</Text>
                  <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
                    {(selectedVisitor.events || []).map((evt: any, idx: number) => (
                      <div key={idx} style={{ padding: "10px 14px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <Badge tone="info">{evt.eventType}</Badge>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                            {(() => {
                              try {
                                return new Date(evt.timestamp).toLocaleTimeString();
                              } catch {
                                return "";
                              }
                            })()}
                          </span>
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
            ⚠️ Storefront Visitors Notice
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
