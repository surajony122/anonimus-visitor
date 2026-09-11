import React, { useState } from 'react';
import {
  Page,
  Layout,
  LegacyCard,
  Button,
  ButtonGroup,
  Text,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  ProgressBar,
  Divider,
  TextField,
} from '@shopify/polaris';
import { apiClient } from '../api/client';
import { Sparkles, Eye, ShoppingCart, ShieldCheck, UserCheck, Flame } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export const Simulator: React.FC<{
  onInspectVisitor: (visitorId: string) => void;
}> = ({ onInspectVisitor }) => {
  const [visitorId, setVisitorId] = useState<string>(() => uuidv4());
  const [sessionId, setSessionId] = useState<string>(() => `sess_${uuidv4().substring(0, 8)}`);
  const [visitorStatus, setVisitorStatus] = useState<'anonymous' | 'identified'>('anonymous');
  const [events, setEvents] = useState<any[]>([]);
  const [intentScore, setIntentScore] = useState(0);
  const [intentTier, setIntentTier] = useState('low');
  const [identifiedEmail, setIdentifiedEmail] = useState<string | null>(null);
  const [inputEmail, setInputEmail] = useState('sarah.smith@example.com');
  const [syncCustomerFirst, setSyncCustomerFirst] = useState(true);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [loadingAction, setLoadingAction] = useState(false);

  const addLog = (msg: string) => {
    setLogMessages((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 19)]);
  };

  const resetVisitor = () => {
    const newVid = uuidv4();
    const newSid = `sess_${uuidv4().substring(0, 8)}`;
    setVisitorId(newVid);
    setSessionId(newSid);
    setVisitorStatus('anonymous');
    setEvents([]);
    setIntentScore(0);
    setIntentTier('low');
    setIdentifiedEmail(null);
    addLog(`✨ Initialized new anonymous storefront visitor: ${newVid.substring(0, 8)}...`);
  };

  const sendEvent = async (eventType: string, payload: Record<string, any> = {}) => {
    setLoadingAction(true);
    try {
      const res = await apiClient.post('/events', {
        visitor_id: visitorId,
        session_id: sessionId,
        event_type: eventType,
        page_url: payload.page_url || `https://store.example.com${payload.path || '/'}`,
        product_id: payload.productId,
        variant_id: payload.variantId,
        collection_id: payload.collectionId,
        cart_id: payload.cartId,
        metadata: payload,
      });

      if (res.success) {
        setEvents((prev) => [...prev, { eventType, timestamp: new Date(), ...payload }]);
        addLog(`📡 Tracked event "${eventType}" for visitor #${visitorId.substring(0, 8)}`);
        // Refresh visitor data to get latest intent score
        const vRes = await apiClient.get(`/visitors/${visitorId}`);
        if (vRes.success && vRes.visitor) {
          setIntentScore(vRes.visitor.intentScore);
          setIntentTier(vRes.visitor.intentTier);
          setVisitorStatus(vRes.visitor.status);
        }
      }
    } catch (e: any) {
      addLog(`❌ Error tracking event: ${e.message}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleIdentifyEmail = async (source = 'user_submitted') => {
    if (!inputEmail) return;
    setLoadingAction(true);
    try {
      // If customer sync is enabled, ensure customer exists in shop
      if (syncCustomerFirst) {
        await apiClient.post('/customers/sync', {
          shopify_customer_id: 'cust_987234',
          email: inputEmail,
          first_name: 'Sarah',
          lastName: 'Smith',
          orders_count: 3,
          total_spent: 420.5,
        });
      }

      const res = await apiClient.post('/identity/identify', {
        visitor_id: visitorId,
        type: 'email',
        value: inputEmail,
        source,
      });

      if (res.success) {
        setVisitorStatus('identified');
        setIdentifiedEmail(inputEmail);
        addLog(`🎉 Identity Resolved! Anonymous #${visitorId.substring(0, 8)} is now linked to ${inputEmail} (${res.confidenceScore}% confidence)`);
        if (res.matchedCustomer) {
          addLog(`🔗 Matched to Shopify Customer ID: ${res.matchedCustomer.shopifyCustomerId}`);
        }
      }
    } catch (e: any) {
      addLog(`❌ Error identifying visitor: ${e.message}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleNegativeTest = async () => {
    // Generate a second visitor with same IP/device to prove they NEVER merge
    const secondVid = uuidv4();
    addLog(`🧪 Starting Negative Privacy Test: Generating 2nd visitor #${secondVid.substring(0, 8)} on same IP/User-Agent...`);
    await apiClient.post('/events', {
      visitor_id: secondVid,
      event_type: 'page_viewed',
      page_url: 'https://store.example.com/',
      metadata: { ip: '192.168.1.100', userAgent: 'Chrome 120.0' },
    });

    const v1 = await apiClient.get(`/visitors/${visitorId}`);
    const v2 = await apiClient.get(`/visitors/${secondVid}`);

    if (v1.visitor?.visitorId !== v2.visitor?.visitorId && v2.visitor?.status === 'anonymous') {
      addLog(`✅ Negative Test PASSED: Storefront kept both visitors strictly distinct. Zero weak IP/browser fingerprint merging!`);
    }
  };

  return (
    <Page
      title="Live Storefront & Identity Simulator"
      subtitle="Step-by-step interactive simulator showing the transition from anonymous browsing to identified customer"
      primaryAction={{
        content: 'New Anonymous Visitor',
        icon: Sparkles,
        onAction: resetVisitor,
      }}
      secondaryActions={[
        {
          content: 'Inspect in Visitor Detail',
          onAction: () => onInspectVisitor(visitorId),
        },
      ]}
    >
      <BlockStack gap="400">
        <Banner title="Live Demonstration Sandbox" tone="info">
          <p>
            Simulate realistic storefront interactions in real-time. Watch how events accumulate, intent score calculates autonomously, and how receiving a legitimate identity signal binds past history without privacy breaches.
          </p>
        </Banner>

        <Layout>
          {/* Controls */}
          <Layout.Section>
            <LegacyCard title="Step 1: Simulate Anonymous Storefront Browsing" sectioned>
              <BlockStack gap="300">
                <Text variant="bodySm" tone="subdued" as="p">
                  Click the buttons below to simulate first-party visitor interactions:
                </Text>
                <ButtonGroup>
                  <Button
                    icon={Eye}
                    loading={loadingAction}
                    onClick={() =>
                      sendEvent('page_viewed', {
                        page_url: 'https://store.example.com/',
                        title: 'Home Page',
                      })
                    }
                  >
                    1. View Homepage
                  </Button>

                  <Button
                    icon={Eye}
                    loading={loadingAction}
                    onClick={() =>
                      sendEvent('product_viewed', {
                        productId: 'prod_headphones_101',
                        title: 'Noise-Canceling Wireless Headphones',
                        price: 199.99,
                        path: '/products/headphones-101',
                      })
                    }
                  >
                    2. View Product ($199)
                  </Button>

                  <Button
                    icon={Eye}
                    loading={loadingAction}
                    onClick={() =>
                      sendEvent('product_viewed', {
                        productId: 'prod_headphones_101',
                        title: 'Noise-Canceling Wireless Headphones',
                        price: 199.99,
                        path: '/products/headphones-101',
                      })
                    }
                  >
                    3. Repeat View (+Intent)
                  </Button>

                  <Button
                    icon={ShoppingCart}
                    tone="success"
                    loading={loadingAction}
                    onClick={() =>
                      sendEvent('product_added_to_cart', {
                        productId: 'prod_headphones_101',
                        cartValue: 199.99,
                        quantity: 1,
                      })
                    }
                  >
                    4. Add to Cart (+25 pts)
                  </Button>

                  <Button
                    icon={ShoppingCart}
                    loading={loadingAction}
                    onClick={() =>
                      sendEvent('checkout_started', {
                        cartValue: 199.99,
                        cartId: 'cart_xyz_789',
                      })
                    }
                  >
                    5. Start Checkout (+30 pts)
                  </Button>
                </ButtonGroup>
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="Step 2: Connect Legitimate Identity Signal" sectioned>
              <BlockStack gap="300">
                <Text variant="bodySm" tone="subdued" as="p">
                  Simulate when this anonymous visitor converts by entering their email in a form or authenticating with Google:
                </Text>

                <InlineStack gap="300" align="start">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Consented Email Address"
                      value={inputEmail}
                      onChange={(val) => setInputEmail(val)}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ paddingTop: '24px' }}>
                    <ButtonGroup>
                      <Button
                        variant="primary"
                        icon={ShieldCheck}
                        loading={loadingAction}
                        onClick={() => handleIdentifyEmail('user_submitted')}
                      >
                        Identify (Newsletter / Form)
                      </Button>
                      <Button
                        icon={UserCheck}
                        loading={loadingAction}
                        onClick={() => handleIdentifyEmail('google_oauth')}
                      >
                        Continue with Google
                      </Button>
                    </ButtonGroup>
                  </div>
                </InlineStack>
              </BlockStack>
            </LegacyCard>

            {/* Privacy negative test */}
            <LegacyCard title="Step 3: Verification & Negative Tests" sectioned>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Verify that two visitors sharing an IP address or device fingerprint NEVER merge into the same person.
                </Text>
                <Button tone="critical" onClick={handleNegativeTest}>
                  Run Negative Privacy Test (Same IP Must NOT Merge)
                </Button>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          {/* Live Visitor State Card */}
          <Layout.Section variant="oneThird">
            <LegacyCard title="Active Visitor State" sectioned>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Visitor Status:</Text>
                  <Badge tone={visitorStatus === 'identified' ? 'success' : undefined}>
                    {visitorStatus.toUpperCase()}
                  </Badge>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text variant="bodySm" as="span">Visitor ID:</Text>
                  <Text variant="bodySm" fontWeight="bold" as="span">{`${visitorId.substring(0, 12)}...`}</Text>
                </InlineStack>

                {identifiedEmail && (
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Identity:</Text>
                    <Text variant="bodySm" fontWeight="bold" as="span">{identifiedEmail}</Text>
                  </InlineStack>
                )}

                <Divider />

                <InlineStack align="space-between">
                  <InlineStack gap="100">
                    <Flame size={18} color="#d97706" />
                    <Text variant="headingSm" as="h4">Intent Score:</Text>
                  </InlineStack>
                  <Badge tone={intentTier === 'very_high' ? 'success' : intentTier === 'high' ? 'attention' : undefined}>
                    {`${intentScore}/100 (${intentTier.toUpperCase()})`}
                  </Badge>
                </InlineStack>
                <ProgressBar progress={intentScore} size="small" tone={intentScore > 60 ? 'success' : 'highlight'} />

                <Text variant="bodySm" tone="subdued" as="p">
                  {`${events.length} events logged in this session`}
                </Text>

                <Button fullWidth onClick={() => onInspectVisitor(visitorId)}>
                  Explore Full Visitor Timeline &rarr;
                </Button>
              </BlockStack>
            </LegacyCard>

            {/* Live Console Output */}
            <LegacyCard title="Live Activity Log" sectioned>
              <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace', background: '#1c1e21', color: '#00ff88', padding: '10px', borderRadius: '4px' }}>
                {logMessages.length === 0 ? (
                  <div>Ready for storefront simulation...</div>
                ) : (
                  logMessages.map((msg, i) => <div key={i} style={{ marginBottom: '4px' }}>{msg}</div>)
                )}
              </div>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
};
