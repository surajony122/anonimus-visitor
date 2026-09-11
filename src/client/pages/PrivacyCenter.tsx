import React, { useEffect, useState } from 'react';
import {
  Page,
  Layout,
  LegacyCard,
  Select,
  Checkbox,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Divider,
} from '@shopify/polaris';
import { apiClient } from '../api/client';
import { Trash2, Download, RefreshCw } from 'lucide-react';

export const PrivacyCenter: React.FC = () => {
  const [retentionDays, setRetentionDays] = useState('90');
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [marketingTrackingEnabled, setMarketingTrackingEnabled] = useState(true);
  const [consentModeRequired, setConsentModeRequired] = useState(false);

  const [deleteVisitorId, setDeleteVisitorId] = useState('');
  const [exportVisitorId, setExportVisitorId] = useState('');
  const [exportedJson, setExportedJson] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await apiClient.get('/privacy/settings');
        if (res.success && res.settings) {
          setRetentionDays(String(res.settings.retentionDays || 90));
          setTrackingEnabled(res.settings.trackingEnabled ?? true);
          setAnalyticsEnabled(res.settings.analyticsEnabled ?? true);
          setMarketingTrackingEnabled(res.settings.marketingTrackingEnabled ?? true);
          setConsentModeRequired(res.settings.consentModeRequired ?? false);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await apiClient.post('/privacy/settings', {
        retentionDays: Number(retentionDays),
        trackingEnabled,
        analyticsEnabled,
        marketingTrackingEnabled,
        consentModeRequired,
      });
      if (res.success) {
        setStatusMessage('Privacy settings updated successfully');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVisitor = async () => {
    if (!deleteVisitorId) return;
    try {
      const res = await apiClient.post('/privacy/delete-visitor', { visitor_id: deleteVisitorId });
      if (res.success) {
        setStatusMessage(`GDPR Erasure completed: Visitor ${deleteVisitorId} and all associated events purged.`);
        setDeleteVisitorId('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportVisitor = async () => {
    if (!exportVisitorId) return;
    try {
      const res = await apiClient.get(`/privacy/export/${exportVisitorId}`);
      if (res.success) {
        setExportedJson(JSON.stringify(res.export, null, 2));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePurgeExpired = async () => {
    try {
      const res = await apiClient.post('/privacy/purge-expired', {});
      if (res.success) {
        setStatusMessage(`Purge completed: ${res.result.deletedEventsCount} events and ${res.result.deletedVisitorsCount} expired visitors removed.`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Page
      title="Privacy & Compliance Center"
      subtitle="Data retention governance, GDPR / CCPA right-to-be-forgotten erasure and privacy controls"
    >
      <BlockStack gap="400">
        {statusMessage && (
          <Banner tone="success" onDismiss={() => setStatusMessage(null)}>
            <p>{statusMessage}</p>
          </Banner>
        )}

        <Banner title="Shopify Customer Privacy & Zero-Fingerprint Guarantee" tone="info">
          <p>
            This application complies with Shopify Customer Privacy requirements. No browser passwords, Chrome account profiles, or cross-site tracking fingerprints are ever accessed.
          </p>
        </Banner>

        <Layout>
          {/* Settings Section */}
          <Layout.Section>
            <LegacyCard title="Data Retention & Tracking Configuration" sectioned>
              <BlockStack gap="400">
                <Select
                  label="Data Retention Period"
                  helpText="Events and un-identified visitor records older than this threshold will be automatically purged."
                  options={[
                    { label: '30 Days', value: '30' },
                    { label: '60 Days', value: '60' },
                    { label: '90 Days (Recommended default)', value: '90' },
                    { label: '180 Days', value: '180' },
                    { label: '365 Days', value: '365' },
                  ]}
                  value={retentionDays}
                  onChange={(val) => setRetentionDays(val)}
                />

                <Divider />

                <Text variant="headingXs" as="h4">Tracking Toggles</Text>
                <Checkbox
                  label="Storefront Tracking Active"
                  helpText="Allow first-party visitor and session event collection on the storefront."
                  checked={trackingEnabled}
                  onChange={(newChecked) => setTrackingEnabled(newChecked)}
                />

                <Checkbox
                  label="Customer Analytics Engine Active"
                  helpText="Enable intent scoring and customer journey aggregation."
                  checked={analyticsEnabled}
                  onChange={(newChecked) => setAnalyticsEnabled(newChecked)}
                />

                <Checkbox
                  label="Marketing & Campaign Tracking"
                  helpText="Capture UTM sources and campaign referrers on sessions."
                  checked={marketingTrackingEnabled}
                  onChange={(newChecked) => setMarketingTrackingEnabled(newChecked)}
                />

                <Checkbox
                  label="Strict Consent Mode (GDPR Banner Required)"
                  helpText="Only record storefront events if the visitor has explicitly accepted tracking consent."
                  checked={consentModeRequired}
                  onChange={(newChecked) => setConsentModeRequired(newChecked)}
                />

                <InlineStack align="start" gap="200">
                  <Button variant="primary" loading={saving} onClick={handleSaveSettings}>
                    Save Settings
                  </Button>
                  <Button icon={RefreshCw} onClick={handlePurgeExpired}>
                    Trigger Expired Retention Purge Now
                  </Button>
                </InlineStack>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          {/* GDPR / Erasure Tools */}
          <Layout.Section variant="oneThird">
            <LegacyCard title="GDPR / CCPA Erasure Tool" sectioned>
              <BlockStack gap="300">
                <Text variant="bodySm" as="p">
                  Completely delete a visitor, their sessions, events, and all identity links upon request.
                </Text>

                <TextField
                  label="Visitor ID to Erase"
                  placeholder="e.g. 8f5f6d22-8b1c..."
                  value={deleteVisitorId}
                  onChange={(val) => setDeleteVisitorId(val)}
                  autoComplete="off"
                />

                <Button tone="critical" fullWidth icon={Trash2} onClick={handleDeleteVisitor} disabled={!deleteVisitorId}>
                  Permanently Delete Visitor Data
                </Button>
              </BlockStack>
            </LegacyCard>

            <LegacyCard title="GDPR Data Export Tool" sectioned>
              <BlockStack gap="300">
                <Text variant="bodySm" as="p">
                  Export all stored events and identity graph connections for a visitor.
                </Text>

                <TextField
                  label="Visitor ID to Export"
                  placeholder="e.g. 8f5f6d22-8b1c..."
                  value={exportVisitorId}
                  onChange={(val) => setExportVisitorId(val)}
                  autoComplete="off"
                />

                <Button fullWidth icon={Download} onClick={handleExportVisitor} disabled={!exportVisitorId}>
                  Export JSON Archive
                </Button>

                {exportedJson && (
                  <pre style={{ maxHeight: '150px', overflowY: 'auto', background: '#f6f6f7', padding: '8px', fontSize: '11px', borderRadius: '4px' }}>
                    {exportedJson}
                  </pre>
                )}
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
};
