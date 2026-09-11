import React, { useEffect, useState } from 'react';
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
  Modal,
  TextField,
  Select,
} from '@shopify/polaris';
import { apiClient } from '../api/client';
import {
  ShieldCheck,
  Key,
  Flame,
} from 'lucide-react';

export const VisitorDetail: React.FC<{
  visitorId: string;
  onBack: () => void;
}> = ({ visitorId, onBack }) => {
  const [visitor, setVisitor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isIdentifyModalOpen, setIsIdentifyModalOpen] = useState(false);
  const [identifyType, setIdentifyType] = useState('email');
  const [identifyValue, setIdentifyValue] = useState('');
  const [identifySource, setIdentifySource] = useState('user_submitted');
  const [identifying, setIdentifying] = useState(false);

  const fetchVisitorDetail = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/visitors/${visitorId}`);
      if (res.success) {
        setVisitor(res.visitor);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVisitorDetail();
  }, [visitorId]);

  const handleResolveIdentity = async () => {
    if (!identifyValue) return;
    setIdentifying(true);
    try {
      const res = await apiClient.post('/identity/identify', {
        visitor_id: visitorId,
        type: identifyType,
        value: identifyValue,
        source: identifySource,
      });
      if (res.success) {
        setIsIdentifyModalOpen(false);
        setIdentifyValue('');
        await fetchVisitorDetail();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIdentifying(false);
    }
  };

  if (loading || !visitor) {
    return (
      <Page title="Visitor Journey & Identity Details" backAction={{ content: 'Back', onAction: onBack }}>
        <LegacyCard sectioned>
          <Text variant="bodyMd" as="p">Loading visitor journey...</Text>
        </LegacyCard>
      </Page>
    );
  }

  const isIdentified = visitor.status === 'identified';
  const customerLink = visitor.customerLinks?.[0]?.customer;
  const identities = visitor.identities || [];
  const events = visitor.events || [];
  const auditLogs = visitor.auditLogs || [];

  return (
    <Page
      title={
        isIdentified
          ? customerLink?.firstName
            ? `${customerLink.firstName} ${customerLink.lastName || ''}`
            : identities[0]?.identityType === 'email'
            ? 'Identified Customer'
            : `Identified Visitor #${visitor.visitorId.substring(0, 8)}`
          : `Anonymous Visitor #${visitor.visitorId.substring(0, 8)}`
      }
      subtitle={`Persistent Visitor ID: ${visitor.visitorId}`}
      backAction={{ content: 'Back to Visitors', onAction: onBack }}
      primaryAction={
        !isIdentified
          ? {
              content: 'Connect Identity Signal',
              icon: ShieldCheck,
              onAction: () => setIsIdentifyModalOpen(true),
            }
          : undefined
      }
    >
      <BlockStack gap="400">
        {/* Status banner */}
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
          {/* Main timeline */}
          <Layout.Section>
            <LegacyCard title="Customer Historical Journey & Event Timeline" sectioned>
              <BlockStack gap="400">
                <Text variant="bodySm" tone="subdued" as="p">
                  Chronological trail showing early anonymous touchpoints connected seamlessly to any subsequent identification events.
                </Text>

                <div style={{ position: 'relative', paddingLeft: '24px', borderLeft: '2px solid #e1e3e5' }}>
                  {events.length === 0 ? (
                    <Text variant="bodyMd" tone="subdued" as="p">No events recorded for this visitor.</Text>
                  ) : (
                    events.map((evt: any, idx: number) => {
                      const dateStr = new Date(evt.timestamp).toLocaleString();
                      let metaObj: any = {};
                      try {
                        if (evt.metadata) metaObj = JSON.parse(evt.metadata);
                      } catch {}

                      let badgeTone: 'success' | 'attention' | 'info' | undefined = undefined;
                      if (evt.eventType === 'checkout_completed') badgeTone = 'success';
                      else if (evt.eventType === 'product_added_to_cart') badgeTone = 'attention';
                      else if (evt.eventType === 'checkout_started') badgeTone = 'attention';

                      return (
                        <div key={evt.id || idx} style={{ marginBottom: '24px', position: 'relative' }}>
                          <div
                            style={{
                              position: 'absolute',
                              left: '-31px',
                              top: '2px',
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              backgroundColor:
                                evt.eventType === 'checkout_completed'
                                  ? '#008060'
                                  : evt.eventType === 'product_added_to_cart'
                                  ? '#d97706'
                                  : '#5c5f62',
                              border: '2px solid white',
                            }}
                          />
                          <BlockStack gap="100">
                            <InlineStack gap="200" align="start">
                              <Badge tone={badgeTone}>{evt.eventType.replace(/_/g, ' ').toUpperCase()}</Badge>
                              <Text variant="bodySm" tone="subdued" as="span">{dateStr}</Text>
                            </InlineStack>

                            {evt.productId && (
                              <Text variant="bodyMd" as="p">
                                <strong>Product ID:</strong> {evt.productId} {metaObj.title ? `(${metaObj.title})` : ''}
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

            {/* Audit Logs */}
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
                        <strong>{new Date(log.timestamp).toLocaleString()}:</strong> Action{' '}
                        <code>{log.action}</code> via <code>{log.source}</code> {`(Confidence: ${log.confidence}/100)`}
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          {/* Sidebar cards */}
          <Layout.Section variant="oneThird">
            {/* Intent Engine Card */}
            <LegacyCard title="Behavioral Intent Score" sectioned>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="100">
                    <Flame size={20} color="#d97706" />
                    <Text variant="headingMd" as="h3">{`${visitor.intentScore} / 100`}</Text>
                  </InlineStack>
                  <Badge tone={visitor.intentTier === 'very_high' ? 'success' : visitor.intentTier === 'high' ? 'attention' : undefined}>
                    {`${visitor.intentTier?.toUpperCase()} INTENT`}
                  </Badge>
                </InlineStack>
                <ProgressBar progress={visitor.intentScore} size="small" tone={visitor.intentScore > 60 ? 'success' : 'highlight'} />

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

            {/* Identity Graph Card */}
            <LegacyCard title="Identity Graph" sectioned>
              <BlockStack gap="300">
                <InlineStack gap="200">
                  <Key size={18} color="#2563eb" />
                  <Text variant="headingSm" as="h4">Resolved Identifiers</Text>
                </InlineStack>

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

                {customerLink && (
                  <BlockStack gap="100">
                    <Text variant="headingXs" as="h4">Shopify Customer Record</Text>
                    <Text variant="bodySm" as="p">
                      <strong>Name:</strong> {customerLink.firstName} {customerLink.lastName}
                    </Text>
                    <Text variant="bodySm" as="p">
                      <strong>Shopify Customer ID:</strong> {customerLink.shopifyCustomerId}
                    </Text>
                    <Text variant="bodySm" as="p">
                      <strong>Total Orders:</strong> {`${customerLink.ordersCount} ($${customerLink.totalSpent})`}
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>

        {/* Modal to connect identity */}
        <Modal
          open={isIdentifyModalOpen}
          onClose={() => setIsIdentifyModalOpen(false)}
          title="Connect Consented Identity Signal"
          primaryAction={{
            content: identifying ? 'Connecting...' : 'Resolve Identity',
            onAction: handleResolveIdentity,
            disabled: !identifyValue || identifying,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setIsIdentifyModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="info">
                <p>
                  Demonstrates the transition when an anonymous visitor voluntarily enters an email, logs in, or completes checkout.
                </p>
              </Banner>

              <Select
                label="Identity Type"
                options={[
                  { label: 'Email Address (Consented / Login)', value: 'email' },
                  { label: 'Phone Number (SMS / OTP)', value: 'phone' },
                  { label: 'Shopify Customer ID', value: 'shopify_customer' },
                  { label: 'Google OAuth Account', value: 'google_account' },
                ]}
                value={identifyType}
                onChange={(val) => setIdentifyType(val)}
              />

              <TextField
                label="Identity Value"
                placeholder={identifyType === 'email' ? 'customer@example.com' : '+15551234567'}
                value={identifyValue}
                onChange={(val) => setIdentifyValue(val)}
                autoComplete="off"
              />

              <Select
                label="Identity Source"
                options={[
                  { label: 'User Submitted (Form / Newsletter)', value: 'user_submitted' },
                  { label: 'Shopify Checkout Completed', value: 'checkout' },
                  { label: 'Shopify Customer Login', value: 'shopify_customer' },
                  { label: 'Google Sign-In Button', value: 'google_oauth' },
                ]}
                value={identifySource}
                onChange={(val) => setIdentifySource(val)}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
};
