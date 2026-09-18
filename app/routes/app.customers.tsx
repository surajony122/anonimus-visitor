import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator, Link, useRouteError } from "@remix-run/react";
import React, { useState, useEffect } from "react";
import {
  Page,
  LegacyCard,
  DataTable,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  let customers: any[] = [];
  try {
    customers = await prisma.shopifyCustomer.findMany({
      include: {
        visitorLinks: {
          include: {
            visitor: {
              include: { events: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    });
  } catch (dbErr) {
    console.warn("Customers DB query fallback:", dbErr);
  }

  return json({
    customers: customers.map((c) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      firstName: c.firstName,
      lastName: c.lastName,
      emailReference: c.emailReference,
      phoneReference: c.phoneReference,
      ordersCount: c.ordersCount,
      totalSpent: c.totalSpent,
      visitorLinks: c.visitorLinks.map((l) => ({
        id: l.id,
        matchMethod: l.matchMethod,
        confidenceScore: l.confidenceScore,
        visitor: {
          visitorId: l.visitor.visitorId,
        },
      })),
    })),
  });
};

export default function CustomersRoute() {
  const { customers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("just now");

  const handleManualRefresh = () => {
    revalidator.revalidate();
    setLastRefreshedAt(new Date().toLocaleTimeString());
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      revalidator.revalidate();
      setLastRefreshedAt(new Date().toLocaleTimeString());
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, revalidator]);

  const rows = (customers || []).map((c: any) => {
    const linkedVisitor = c.visitorLinks?.[0]?.visitor;
    const matchMethod = c.visitorLinks?.[0]?.matchMethod || "manual";

    return [
      <BlockStack key={`cust_${c.id}`} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {`${c.firstName || ""} ${c.lastName || ""}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {`ID: ${c.shopifyCustomerId}`}
        </Text>
      </BlockStack>,
      c.emailReference || "—",
      c.phoneReference || "—",
      `${c.ordersCount} orders ($${c.totalSpent})`,
      linkedVisitor ? (
        <InlineStack gap="100" align="center">
          <Badge tone="success">{`Linked to #${(linkedVisitor.visitorId || "visitor").substring(0, 8)}`}</Badge>
          <Text variant="bodySm" tone="subdued" as="span">{`(${matchMethod})`}</Text>
        </InlineStack>
      ) : (
        <Badge tone="warning">No Storefront Activity Linked</Badge>
      ),
      linkedVisitor ? (
        <Link
          to={`/app/visitors/${linkedVisitor.visitorId || linkedVisitor.id}`}
          style={{
            display: "inline-block",
            padding: "6px 12px",
            background: "#2563eb",
            color: "#ffffff",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "600",
            textDecoration: "none",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          View Journey &rarr;
        </Link>
      ) : (
        "—"
      ),
    ];
  });

  return (
    <Page
      title="Shopify Customer Intelligence"
      subtitle="Shopify customer profiles mapped to real storefront browsing behavior & historical journeys"
      primaryAction={{
        content: isRefreshing ? "Refreshing..." : "🔄 Refresh Data",
        loading: isRefreshing,
        onAction: handleManualRefresh,
      }}
      secondaryActions={[
        {
          content: autoRefresh ? "🟢 Live Auto-Refresh (5s)" : "⏸️ Auto-Refresh: Off",
          onAction: () => setAutoRefresh(!autoRefresh),
        },
      ]}
    >
      <BlockStack gap="400">
        <LegacyCard>
          {customers.length === 0 ? (
            <EmptyState
              heading="No synced Shopify customers yet"
              action={{
                content: "Open Simulator",
                onAction: () => navigate("/app/simulator"),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When customers register, login, or complete orders, their Shopify customer profiles link to their historical storefront visitor journeys.</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={["Customer", "Email", "Phone", "Orders & Spent", "Visitor Graph Link", "Action"]}
              rows={rows as any}
            />
          )}
        </LegacyCard>
      </BlockStack>
    </Page>
  );
}


export function ErrorBoundary() {
  const error = useRouteError() as any;
  console.error("Customers Intelligence Route Error:", error);

  return (
    <Page fullWidth>
      <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ background: "#fff4f4", border: "1px solid #fecaca", borderRadius: "10px", padding: "24px" }}>
          <h2 style={{ color: "#b91c1c", margin: "0 0 10px 0", fontSize: "18px", fontWeight: 700 }}>
            ⚠️ Customers Intelligence Loading Notice
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
