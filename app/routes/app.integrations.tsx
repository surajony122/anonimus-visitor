import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import React, { useState } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  TextField,
  Select,
  Button,
  Banner,
  DataTable,
  Badge,
  InlineStack,
  BlockStack,
  Divider,
  Text,
  List,
} from "@shopify/polaris";
import prisma from "../db.server";
import { WebhookDispatcher } from "../services/webhookDispatcher.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  let endpoints: any[] = [];
  let logs: any[] = [];

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      include: {
        webhookEndpoints: {
          orderBy: { createdAt: "desc" },
          include: {
            deliveryLogs: {
              orderBy: { timestamp: "desc" },
              take: 5,
            },
          },
        },
      },
    });

    if (shop) {
      endpoints = shop.webhookEndpoints.map((ep) => ({
        id: ep.id,
        name: ep.name,
        url: ep.url,
        triggerOn: ep.triggerOn,
        isActive: ep.isActive,
        lastTriggeredAt: ep.lastTriggeredAt ? ep.lastTriggeredAt.toISOString() : null,
        createdAt: ep.createdAt.toISOString(),
      }));

      // Gather recent logs across endpoints
      const allLogs = await prisma.webhookDeliveryLog.findMany({
        where: {
          webhookEndpoint: { shopId: shop.id },
        },
        orderBy: { timestamp: "desc" },
        take: 15,
        include: { webhookEndpoint: true },
      });

      logs = allLogs.map((l) => ({
        id: l.id,
        endpointName: l.webhookEndpoint.name,
        trigger: l.eventTrigger,
        status: l.responseStatus,
        success: l.success,
        response: l.responseBody,
        timestamp: l.timestamp.toISOString(),
      }));
    }
  } catch (err) {
    console.error("Integrations loader error:", err);
  }

  return json({ endpoints, logs, shopDomain });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  try {
    let shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      shop = await prisma.shop.create({
        data: { shopDomain },
      });
    }

    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "create_endpoint") {
      const name = String(formData.get("name") || "Webhook Endpoint");
      const url = String(formData.get("url") || "");
      const triggerOn = String(formData.get("triggerOn") || "high_intent_reached");
      const secret = String(formData.get("secret") || "");

      if (!url || !url.startsWith("http")) {
        return json({ error: "Please enter a valid HTTP / HTTPS URL." }, { status: 400 });
      }

      await prisma.webhookEndpoint.create({
        data: {
          shopId: shop.id,
          name,
          url,
          triggerOn,
          secret: secret || null,
          isActive: true,
        },
      });

      return json({ success: true, message: `Webhook '${name}' created successfully!` });
    }

    if (actionType === "delete_endpoint") {
      const endpointId = String(formData.get("endpointId") || "");
      await prisma.webhookEndpoint.delete({
        where: { id: endpointId },
      });
      return json({ success: true, message: "Webhook endpoint deleted." });
    }

    if (actionType === "toggle_endpoint") {
      const endpointId = String(formData.get("endpointId") || "");
      const isActive = formData.get("isActive") === "true";
      await prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { isActive },
      });
      return json({ success: true, message: `Webhook ${isActive ? "activated" : "paused"}.` });
    }

    if (actionType === "test_endpoint") {
      const endpointId = String(formData.get("endpointId") || "");
      const testResult = await WebhookDispatcher.sendTest(endpointId);
      return json({
        success: testResult.success,
        testResult,
        message: testResult.success
          ? `Test successful! Response: HTTP ${testResult.responseStatus} (${testResult.durationMs}ms)`
          : `Test failed: HTTP ${testResult.responseStatus} - ${testResult.responseBody}`,
      });
    }
  } catch (err: any) {
    console.error("Integrations action error:", err);
    return json({ error: err.message || "Failed to process request" }, { status: 500 });
  }

  return json({});
};

export default function IntegrationsRoute() {
  const { endpoints, logs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [triggerOn, setTriggerOn] = useState("high_intent_reached");
  const [secret, setSecret] = useState("");

  const handleCreate = () => {
    if (!url) return;
    const fd = new FormData();
    fd.append("actionType", "create_endpoint");
    fd.append("name", name || "Outbound Alert Webhook");
    fd.append("url", url);
    fd.append("triggerOn", triggerOn);
    fd.append("secret", secret);
    submit(fd, { method: "POST" });
    setName("");
    setUrl("");
    setSecret("");
  };

  const handleTest = (endpointId: string) => {
    const fd = new FormData();
    fd.append("actionType", "test_endpoint");
    fd.append("endpointId", endpointId);
    submit(fd, { method: "POST" });
  };

  const handleDelete = (endpointId: string) => {
    const fd = new FormData();
    fd.append("actionType", "delete_endpoint");
    fd.append("endpointId", endpointId);
    submit(fd, { method: "POST" });
  };

  const handleToggle = (endpointId: string, currentActive: boolean) => {
    const fd = new FormData();
    fd.append("actionType", "toggle_endpoint");
    fd.append("endpointId", endpointId);
    fd.append("isActive", String(!currentActive));
    submit(fd, { method: "POST" });
  };

  const endpointsTableRows = endpoints.map((ep: any) => [
    <BlockStack key={ep.id} gap="050">
      <Text variant="bodyMd" fontWeight="bold" as="span">{ep.name}</Text>
      <Text variant="bodySm" tone="subdued" as="span">{ep.url}</Text>
    </BlockStack>,
    <Badge key={`${ep.id}-trigger`} tone="info">
      {ep.triggerOn.replace(/_/g, " ").toUpperCase()}
    </Badge>,
    <Badge key={`${ep.id}-status`} tone={ep.isActive ? "success" : undefined}>
      {ep.isActive ? "ACTIVE" : "PAUSED"}
    </Badge>,
    ep.lastTriggeredAt ? new Date(ep.lastTriggeredAt).toLocaleString() : "Never",
    <InlineStack key={`${ep.id}-actions`} gap="200">
      <Button size="slim" onClick={() => handleTest(ep.id)} loading={isSubmitting}>
        Send Test Payload
      </Button>
      <Button size="slim" onClick={() => handleToggle(ep.id, ep.isActive)}>
        {ep.isActive ? "Pause" : "Resume"}
      </Button>
      <Button size="slim" tone="critical" onClick={() => handleDelete(ep.id)}>
        Delete
      </Button>
    </InlineStack>,
  ]);

  const logsTableRows = logs.map((log: any) => [
    <Text key={log.id} variant="bodySm" as="span">
      {new Date(log.timestamp).toLocaleTimeString()}
    </Text>,
    <Text key={`${log.id}-name`} variant="bodySm" fontWeight="bold" as="span">
      {log.endpointName}
    </Text>,
    <Badge key={`${log.id}-trigger`}>{log.trigger}</Badge>,
    <Badge key={`${log.id}-status`} tone={log.success ? "success" : "critical"}>
      {log.status ? `HTTP ${log.status}` : "FAILED"}
    </Badge>,
    <Text key={`${log.id}-resp`} variant="bodySm" tone="subdued" as="span" truncate>
      {log.response || (log.success ? "OK" : "No response")}
    </Text>,
  ]);

  return (
    <Page
      title="Marketing Integrations & Webhooks"
      subtitle="Connect Nitro intelligence triggers to Zapier, Klaviyo, WhatsApp, Make.com, or custom APIs"
    >
      <BlockStack gap="400">
        {actionData && (actionData as any).message && (
          <Banner tone={(actionData as any).success ? "success" : "critical"}>
            <p>{(actionData as any).message}</p>
          </Banner>
        )}

        {actionData && (actionData as any).error && (
          <Banner tone="critical">
            <p>{(actionData as any).error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <LegacyCard title="Active Webhook Endpoints" sectioned>
              <BlockStack gap="300">
                {endpoints.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No webhooks configured yet. Create an endpoint on the right to receive real-time alerts.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Endpoint Name & URL", "Trigger Event", "Status", "Last Fired", "Actions"]}
                    rows={endpointsTableRows}
                  />
                )}
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="Recent Delivery Logs (Last 15 Dispatches)" sectioned>
              <BlockStack gap="300">
                {logs.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No webhook deliveries logged yet. Click "Send Test Payload" above to verify connectivity.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Time", "Endpoint", "Trigger", "Result", "Response Preview"]}
                    rows={logsTableRows}
                  />
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <LegacyCard title="Add New Webhook Integration" sectioned>
              <BlockStack gap="300">
                <TextField
                  label="Integration Name"
                  placeholder="e.g. Klaviyo High Intent / Zapier WhatsApp"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                />

                <TextField
                  label="Target Webhook URL"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={url}
                  onChange={setUrl}
                  autoComplete="off"
                  helpText="Destination HTTP POST endpoint that receives the JSON payload."
                />

                <Select
                  label="Trigger Event"
                  options={[
                    { label: "High Intent Reached (Score >= 70)", value: "high_intent_reached" },
                    { label: "Cart Abandoned Drop-off", value: "cart_abandoned" },
                    { label: "Identity Resolved (Anonymous -> Known)", value: "identity_resolved" },
                    { label: "All Triggers", value: "all" },
                  ]}
                  value={triggerOn}
                  onChange={setTriggerOn}
                />

                <TextField
                  label="Secret Key (Optional HMAC-SHA256)"
                  placeholder="Enter secret for signing payload"
                  value={secret}
                  onChange={setSecret}
                  autoComplete="off"
                  helpText="If provided, payloads are signed in X-Nitro-Signature-SHA256 header."
                />

                <Button variant="primary" fullWidth onClick={handleCreate} disabled={!url} loading={isSubmitting}>
                  Save & Activate Webhook
                </Button>
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="Popular Use Cases" sectioned>
              <BlockStack gap="200">
                <Text variant="headingXs" as="h4">Instant Recovery Actions</Text>
                <List type="bullet">
                  <List.Item>
                    <strong>WhatsApp Alert:</strong> Ping sales rep when a visitor has Very High Intent with $200+ in cart.
                  </List.Item>
                  <List.Item>
                    <strong>Klaviyo Flow:</strong> Add identified visitor to "Hot VIP Browsers" list with their viewed product.
                  </List.Item>
                  <List.Item>
                    <strong>Slack Notification:</strong> Send real-time channel alert when high-intent customer adds items.
                  </List.Item>
                </List>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
