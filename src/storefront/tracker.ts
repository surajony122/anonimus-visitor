/**
 * Nitro-Like Lightweight First-Party Storefront Tracker SDK
 * 
 * Privacy Principles:
 * - Strictly operates within first-party merchant storefront context
 * - Generates high-entropy UUID v4 visitor ID
 * - Session expiry after 30 minutes of inactivity
 * - Non-blocking asynchronous network calls (resilient to API downtime)
 * - Zero access to passwords, private chrome profiles, or private browser state
 */

(function (window: any, document: Document) {
  const STORAGE_VISITOR_KEY = '_nitro_vid';
  const STORAGE_SESSION_KEY = '_nitro_sid';
  const STORAGE_SESSION_EXPIRY_KEY = '_nitro_sexp';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  // High entropy UUID v4 generator
  function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Get or initialize persistent 1st-party Visitor ID
  function getOrCreateVisitorId(): string {
    let visitorId = null;
    try {
      visitorId = localStorage.getItem(STORAGE_VISITOR_KEY);
      if (!visitorId) {
        visitorId = generateUUID();
        localStorage.setItem(STORAGE_VISITOR_KEY, visitorId);
      }
    } catch {
      // Fallback for private browsing if localStorage is restricted
      visitorId = generateUUID();
    }
    return visitorId;
  }

  // Get or initialize current Session ID
  function getOrCreateSessionId(visitorId: string): string {
    const now = Date.now();
    let sessionId = null;
    try {
      const savedSessionId = localStorage.getItem(STORAGE_SESSION_KEY);
      const savedExpiry = localStorage.getItem(STORAGE_SESSION_EXPIRY_KEY);

      if (savedSessionId && savedExpiry && now < Number(savedExpiry)) {
        sessionId = savedSessionId;
      } else {
        sessionId = `sess_${generateUUID().substring(0, 12)}`;
        localStorage.setItem(STORAGE_SESSION_KEY, sessionId);
      }
      localStorage.setItem(STORAGE_SESSION_EXPIRY_KEY, String(now + SESSION_TIMEOUT_MS));
    } catch {
      sessionId = `sess_${generateUUID().substring(0, 12)}`;
    }
    return sessionId;
  }

  class NitroTracker {
    private apiEndpoint: string;
    private shopDomain: string;
    private visitorId: string;
    private sessionId: string;

    constructor(endpoint = '/api', shopDomain?: string) {
      this.apiEndpoint = endpoint;
      this.shopDomain = shopDomain || (window as any).Shopify?.shop || window.location.hostname;
      this.visitorId = getOrCreateVisitorId();
      this.sessionId = getOrCreateSessionId(this.visitorId);
    }

    public getVisitorId(): string {
      return this.visitorId;
    }

    public getSessionId(): string {
      return this.sessionId;
    }

    /**
     * Send event to ingestion endpoint safely (non-blocking)
     */
    public track(eventType: string, payload: Record<string, any> = {}) {
      try {
        const body = {
          visitor_id: this.visitorId,
          session_id: this.sessionId,
          event_type: eventType,
          timestamp: new Date().toISOString(),
          page_url: window.location.href,
          product_id: payload.productId || payload.product_id,
          variant_id: payload.variantId || payload.variant_id,
          collection_id: payload.collectionId || payload.collection_id,
          cart_id: payload.cartId || payload.cart_id,
          metadata: {
            title: document.title,
            referrer: document.referrer,
            ...payload,
          },
        };

        const url = `${this.apiEndpoint}/events`;
        const headers = {
          'Content-Type': 'application/json',
          'x-shopify-shop-domain': this.shopDomain,
        };

        if (typeof navigator !== 'undefined' && navigator.sendBeacon && eventType === 'page_unload') {
          navigator.sendBeacon(url, JSON.stringify(body));
        } else {
          fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            keepalive: true,
          }).catch((err) => {
            // Non-blocking: fail silently to prevent storefront disruption
            console.warn('[NitroTracker] Event ingestion notice:', err.message);
          });
        }
      } catch (err) {
        // Defensive failure handling
        console.warn('[NitroTracker] Failed to dispatch event safely', err);
      }
    }

    /**
     * Consented identity identification (e.g., newsletter signup, login, Google Sign-in)
     */
    public identify(type: 'email' | 'phone' | 'shopify_customer' | 'google_account', value: string, source = 'user_submitted') {
      try {
        const body = {
          visitor_id: this.visitorId,
          type,
          value,
          source,
          metadata: {
            identified_at_url: window.location.href,
          },
        };

        return fetch(`${this.apiEndpoint}/identity/identify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-shop-domain': this.shopDomain,
          },
          body: JSON.stringify(body),
        })
          .then((res) => res.json())
          .catch((err) => {
            console.warn('[NitroTracker] Identify notice:', err.message);
          });
      } catch (err) {
        console.warn('[NitroTracker] Failed to identify safely', err);
      }
    }
  }

  // Expose global singleton
  const trackerInstance = new NitroTracker();
  (window as any).NitroTracker = trackerInstance;

  // Auto-track page view
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    trackerInstance.track('page_viewed');
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      trackerInstance.track('page_viewed');
    });
  }
})(window, document);

export {};
