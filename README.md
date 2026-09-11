# Nitro-Like Shopify Visitor Identity & Customer Intelligence App

A production-grade, privacy-conscious Shopify application that empowers merchants to track storefront visitors anonymously using strictly first-party and Shopify-supported mechanisms, autonomously score behavioral intent, and connect historical anonymous journeys whenever a legitimate identity signal is provided.

---

## 🛡️ Core Privacy Principles & Boundaries

1. **Zero Snooping**: Never attempts to read browser passwords, Chrome account profiles, Google Drive, or personal files.
2. **Zero Weak Probabilistic Merging**: Never uses IP address or browser fingerprints as identity proof. Multiple visitors sharing an IP address or device category remain completely distinct.
3. **Deterministic Identity Resolution**: Only transitions visitors from `anonymous` to `identified` when a verified, consented identifier is provided (e.g. customer login, newsletter signup, checkout completion, or explicit Google OAuth).
4. **Historical Journey Integrity**: When an anonymous visitor later becomes identified, their entire pre-identification browsing history remains intact and connected to their customer record.
5. **Shopify Web Pixel Sandbox**: Fully compliant with Shopify Customer Privacy APIs and Web Pixel extension constraints.
6. **Multi-Tenant Isolation**: Every database object is strictly scoped by `shopId`. Store A can never access Store B's data.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Shopify Storefront                              │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐   │
│  │ Shopify Web Pixel Extension  │   │ First-Party Storefront Script│   │
│  │ (Official Sandbox Analytics) │   │ (UUIDv4 Visitor & Session)   │   │
│  └──────────────┬───────────────┘   └──────────────┬───────────────┘   │
└─────────────────┼──────────────────────────────────┼───────────────────┘
                  │       POST /api/events           │
                  │   (Non-blocking batch ingest)    │
                  ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         App Ingestion Server                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Express + TypeScript REST API Engine                             │  │
│  │ - Multi-tenant Shop Resolver & Token Verifier                    │  │
│  │ - Event Payload Validator (Zod) & Anti-Abuse Rate Limiter        │  │
│  │ - Session Manager & Visitor Tracker                              │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Core Engines                                                     │  │
│  │ 1. Identity Resolution Engine (Deterministic Normalization)      │  │
│  │ 2. Identity Graph Manager (Multi-Tenant & Multi-Source)          │  │
│  │ 3. Intent Scoring Engine (0–100 Propensity Scoring)              │  │
│  │ 4. Shopify Customer Matcher (Authorized Admin GraphQL/Webhooks)  │  │
│  │ 5. Audit Logging Service (Traceable State Transitions)           │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Database Layer (Prisma ORM)                        │
│  PostgreSQL / SQLite Database Schema:                                  │
│  - shops, visitors, sessions, events, identities, identity_links,      │
│    shopify_customers, visitor_customer_links, identity_audit_logs,     │
│    privacy_settings                                                    │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────┴──────────────────────────────────────┐
│                    Merchant Admin Dashboard (React)                    │
│  Shopify Polaris Design System                                         │
│  - Overview Analytics & KPIs (Identification rate %, funnels)          │
│  - Real-Time Visitor Explorer (Anonymous vs Identified)                │
│  - Visitor Detail & Historical Event Timeline                          │
│  - Identity Graph Visualizer & Audit Logs                              │
│  - Customer Intelligence & Intent Breakdown                            │
│  - Privacy & Data Governance Center (GDPR, Retention, Deletion)       │
│  - Interactive End-to-End Simulation & Verification Console            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Schema Summary

- **`shops`**: Tenant store configuration, domain, installation timestamps, and settings.
- **`visitors`**: Scoped by `shop_id`. High-entropy `visitor_id` (UUID string), status (`anonymous`, `identified`, `merged`), `first_seen_at`, `last_seen_at`, `first_source`.
- **`sessions`**: `session_id`, `visitor_id`, `started_at`, `last_activity_at`, `landing_page`, `referrer`, UTM tags.
- **`events`**: Storefront events (`page_viewed`, `product_viewed`, `collection_viewed`, `search_submitted`, `cart_viewed`, `product_added_to_cart`, `checkout_started`, `checkout_completed`), timestamp, productId, cart value.
- **`identities`**: `identity_type` (`email`, `phone`, `shopify_customer`, `google_account`), `identity_value_hash` (SHA-256), encrypted storage, confidence score (100).
- **`identity_links`**: Graph edges between resolved identities.
- **`shopify_customers`**: Shopify customer records (ID, name, email, orders count, total spent).
- **`visitor_customer_links`**: Relational junction connecting visitor journeys to Shopify customers.
- **`identity_audit_logs`**: Immutable audit records for every identity creation, linking, or merging action.
- **`privacy_settings`**: Per-store retention days (30, 60, 90, 180, 365), consent modes, and GDPR queues.

---

## 🔌 API Endpoints

### Storefront & Ingestion
- `POST /api/events` - Ingest storefront event (page views, cart additions, checkouts).
- `POST /api/identity/identify` - Connect consented identity signal to an anonymous visitor.
- `GET /api/identity/graph/:visitorId` - Retrieve identity graph connections and audit trail.

### Admin & Intelligence
- `GET /api/analytics/overview` - Aggregated KPIs, identification rate, conversion funnel, intent distribution.
- `GET /api/visitors` - Filterable visitor list with intent scores, cart values, and statuses.
- `GET /api/visitors/:id` - Detailed visitor profile with intent breakdown.
- `GET /api/visitors/:id/events` - Chronological timeline of all historical events.
- `GET /api/customers` - Synchronized Shopify customer records and their visitor journeys.

### Privacy & Governance
- `GET /api/privacy/settings` & `POST /api/privacy/settings` - Configure retention window & tracking toggles.
- `POST /api/privacy/delete-visitor` - GDPR right-to-be-forgotten deletion.
- `POST /api/privacy/purge-expired` - Purge expired data older than retention threshold.
- `GET /api/privacy/export/:visitorId` - GDPR data portability export.

### Shopify Compliance Webhooks
- `POST /api/webhooks/app-uninstalled` - Cleanup shop access.
- `POST /api/webhooks/customers-redact` - GDPR customer erasure webhook.
- `POST /api/webhooks/shop-redact` - 48-hour post-uninstall data erasure.
- `POST /api/webhooks/customers-data-request` - GDPR export webhook.

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize Database & Prisma Client
```bash
npx prisma db push
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Development Server
```bash
# Start backend API (Port 5000) and frontend Polaris UI (Port 3000)
npm run dev
```

Visit **`http://localhost:3000`** to access the Merchant Admin Dashboard & Interactive Simulator.
