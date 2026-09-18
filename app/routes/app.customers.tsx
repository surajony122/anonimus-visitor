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
import { decryptValue } from "../services/normalizer.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "theunniyarcha.myshopify.com";
  let shopifyCustomersList: any[] = [];
  let dbCustomers: any[] = [];
  let identifiedVisitors: any[] = [];

  try {
    const { admin, session } = await authenticate.admin(request);
    if (session?.shop) shopDomain = session.shop;

    // 1. Fetch real store customers from Shopify GraphQL API
    try {
      const response = await admin.graphql(`
        query GetStoreCustomers {
          customers(first: 50, reverse: true) {
            edges {
              node {
                id
                displayName
                firstName
                lastName
                email
                phone
                numberOfOrders
                amountSpent {
                  amount
                  currencyCode
                }
                createdAt
              }
            }
          }
        }
      `);
      const resJson = await response.json();
      if (resJson?.data?.customers?.edges) {
        shopifyCustomersList = resJson.data.customers.edges.map((e: any) => e.node);
      }
    } catch (graphErr) {
      console.warn("Shopify GraphQL Customers non-blocking warning:", graphErr);
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn("Admin auth non-blocking in customers loader:", err);
  }

  // 2. Fetch DB customer links and identified visitors
  try {
    dbCustomers = await prisma.shopifyCustomer.findMany({
      include: {
        visitorLinks: {
          include: {
            visitor: {
              include: { events: true, identities: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    identifiedVisitors = await prisma.visitor.findMany({
      where: {
        OR: [
          { status: "identified" },
          { identities: { some: {} } },
          { customerLinks: { some: {} } },
        ],
      },
      include: {
        identities: true,
        customerLinks: { include: { customer: true } },
        events: { orderBy: { timestamp: "desc" }, take: 20 },
      },
      take: 500,
    });
  } catch (dbErr) {
    console.warn("Customers DB query fallback:", dbErr);
  }

  // Build lookup maps for fast matching
  const visitorByEmail = new Map<string, any>();
  const visitorByPhone = new Map<string, any>();
  const visitorByCustomerId = new Map<string, any>();

  identifiedVisitors.forEach((v) => {
    (v.identities || []).forEach((i: any) => {
      let val = "";
      const enc = i.identityValueEncrypted || i.encryptedValue;
      if (enc) {
        try { val = decryptValue(enc); } catch {}
      }
      if (val) {
        if (i.identityType === "email") visitorByEmail.set(val.toLowerCase().trim(), v);
        if (i.identityType === "phone") visitorByPhone.set(val.trim(), v);
      }
    });

    (v.customerLinks || []).forEach((cl: any) => {
      if (cl.customer?.shopifyCustomerId) {
        visitorByCustomerId.set(cl.customer.shopifyCustomerId, v);
      }
    });
  });

  dbCustomers.forEach((c) => {
    const linkedVis = c.visitorLinks?.[0]?.visitor;
    if (linkedVis && c.shopifyCustomerId) {
      visitorByCustomerId.set(c.shopifyCustomerId, linkedVis);
      if (c.emailReference) visitorByEmail.set(c.emailReference.toLowerCase().trim(), linkedVis);
      if (c.phoneReference) visitorByPhone.set(c.phoneReference.trim(), linkedVis);
    }
  });

  // Merge Shopify GraphQL Customers with DB data
  const mergedCustomers: any[] = [];

  shopifyCustomersList.forEach((sc: any) => {
    const email = (sc.email || "").toLowerCase().trim();
    const phone = (sc.phone || "").trim();

    // Match with visitor
    const matchedVisitor = visitorByCustomerId.get(sc.id) ||
      (email ? visitorByEmail.get(email) : null) ||
      (phone ? visitorByPhone.get(phone) : null);

    const ordersCount = Number(sc.numberOfOrders || 0);
    const totalSpent = parseFloat(sc.amountSpent?.amount || "0");
    const currency = sc.amountSpent?.currencyCode || "INR";

    mergedCustomers.push({
      id: sc.id,
      shopifyCustomerId: sc.id.replace("gid://shopify/Customer/", ""),
      firstName: sc.firstName || sc.displayName || "Customer",
      lastName: sc.lastName || "",
      emailReference: sc.email || "—",
      phoneReference: sc.phone || "—",
      ordersCount,
      totalSpent: (currency === "INR" ? "₹" : "$") + totalSpent.toLocaleString(),
      linkedVisitorId: matchedVisitor?.visitorId || matchedVisitor?.id || null,
      matchMethod: matchedVisitor ? (email ? "email_match" : "checkout_identity") : null,
    });
  });

  // Also include any identified storefront visitors who entered an email
  identifiedVisitors.forEach((v) => {
    let email = "";
    let phone = "";
    (v.identities || []).forEach((i: any) => {
      let val = "";
      const enc = i.identityValueEncrypted || i.encryptedValue;
      if (enc) {
        try { val = decryptValue(enc); } catch {}
      }
      if (val) {
        if (i.identityType === "email") email = val;
        if (i.identityType === "phone") phone = val;
      }
    });

    if (email && !mergedCustomers.some((c) => c.emailReference.toLowerCase() === email.toLowerCase())) {
      mergedCustomers.push({
        id: v.id,
        shopifyCustomerId: "Storefront Lead",
        firstName: "Storefront Visitor",
        lastName: "",
        emailReference: email,
        phoneReference: phone || "—",
        ordersCount: v.events.filter((e: any) => e.eventType === "checkout_completed").length,
        totalSpent: "₹0",
        linkedVisitorId: v.visitorId || v.id,
        matchMethod: "form_submission",
      });
    }
  });

  return json({
    customers: mergedCustomers,
    shopDomain,
  });
};

export default function CustomersRoute() {
  const { customers = [] } = (useLoaderData<typeof loader>() || {}) as any;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("just now");

  const handleManualRefresh = () => {
    revalidator.revalidate();
    setLastRefreshedAt(new Date().toLocaleTimeString());
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      revalidator.revalidate();
      setLastRefreshedAt(new Date().toLocaleTimeString());
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, revalidator]);

  const rows = (customers || []).map((c: any) => {
    const hasLink = Boolean(c.linkedVisitorId);

    return [
      <BlockStack key={"cust_" + c.id} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {(c.firstName + " " + (c.lastName || "")).trim() || "Customer"}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {"ID: " + c.shopifyCustomerId}
        </Text>
      </BlockStack>,
      c.emailReference || "—",
      c.phoneReference || "—",
      c.ordersCount + " orders (" + c.totalSpent + ")",
      hasLink ? (
        <InlineStack gap="100" align="center">
          <Badge tone="success">{"Linked to #" + String(c.linkedVisitorId).substring(0, 8)}</Badge>
          <Text variant="bodySm" tone="subdued" as="span">{"(" + (c.matchMethod || "verified") + ")"}</Text>
        </InlineStack>
      ) : (
        <Badge tone="warning">No Storefront Activity Linked</Badge>
      ),
      hasLink ? (
        <Link
          to={"/app/visitors/" + c.linkedVisitorId}
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
          content: autoRefresh ? "🟢 Live Auto-Refresh (15s)" : "⏸️ Auto-Refresh: Off",
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
              headings={["Customer", "Email", "Phone", "Orders & Lifetime Spent", "Visitor Graph Link", "Action"]}
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
            ⚠️ Customer Intelligence Loading Notice
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
