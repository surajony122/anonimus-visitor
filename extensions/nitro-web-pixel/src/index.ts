import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init, settings }) => {
  const DEFAULT_ENDPOINT = "https://nitro-shopify-visitor-intelligence.onrender.com/api/events";
  const DEFAULT_IDENTIFY_ENDPOINT = "https://nitro-shopify-visitor-intelligence.onrender.com/api/identity/identify";
  const STORAGE_KEY = "_nitro_vid";

  function generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function getVisitorId(): Promise<string> {
    try {
      let vid = await browser.localStorage.getItem(STORAGE_KEY);
      if (!vid) {
        vid = generateUUID();
        await browser.localStorage.setItem(STORAGE_KEY, vid);
      }
      return vid;
    } catch {
      return generateUUID();
    }
  }

  async function identify(type: "email" | "phone", value: string, source: string, shopDomain: string) {
    if (!value || !value.trim()) return;
    try {
      const visitorId = await getVisitorId();
      fetch(DEFAULT_IDENTIFY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-shopify-shop-domain": shopDomain,
        },
        body: JSON.stringify({
          visitor_id: visitorId,
          type,
          value: value.trim(),
          source,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  async function sendEvent(eventType: string, eventData: any) {
    try {
      const visitorId = await getVisitorId();
      const endpoint = (init.data.accountConfig as any)?.appEndpoint || DEFAULT_ENDPOINT;
      const shopDomain = (init.data.accountConfig as any)?.shopDomain || eventData?.context?.document?.location?.host;
      const href = eventData.context?.document?.location?.href || "";

      // 1. Check for URL parameters (Instant silent capture without form submission)
      try {
        if (href.includes("?")) {
          const urlParams = new URL(href).searchParams;
          const urlEmail = urlParams.get("email") || urlParams.get("utm_email") || urlParams.get("contact");
          const urlPhone = urlParams.get("phone") || urlParams.get("tel") || urlParams.get("whatsapp");
          if (urlEmail && urlEmail.includes("@")) {
            identify("email", urlEmail, "url_campaign_parameter", shopDomain);
          }
          if (urlPhone && urlPhone.length >= 7) {
            identify("phone", urlPhone, "url_campaign_parameter", shopDomain);
          }
        }
      } catch {}

      // 2. Check checkout payload for email / phone
      const checkoutEmail = eventData.data?.checkout?.email || eventData.data?.customer?.email;
      const checkoutPhone = eventData.data?.checkout?.phone || eventData.data?.customer?.phone;
      if (checkoutEmail) identify("email", checkoutEmail, "checkout_step", shopDomain);
      if (checkoutPhone) identify("phone", checkoutPhone, "checkout_step", shopDomain);

      // 3. Extract device & browser intelligence
      const nav = (browser as any)?.navigator || {};
      const doc = eventData.context?.document || {};
      const win = eventData.context?.window || {};

      const userAgent = nav.userAgent || "";
      let browserName = "Chrome";
      if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) browserName = "Safari";
      else if (userAgent.includes("Firefox")) browserName = "Firefox";
      else if (userAgent.includes("Edg")) browserName = "Edge";
      else if (userAgent.includes("Opera") || userAgent.includes("OPR")) browserName = "Opera";

      let osName = "Desktop OS";
      if (userAgent.includes("iPhone") || userAgent.includes("iPad")) osName = "iOS";
      else if (userAgent.includes("Android")) osName = "Android";
      else if (userAgent.includes("Windows")) osName = "Windows";
      else if (userAgent.includes("Mac OS")) osName = "macOS";
      else if (userAgent.includes("Linux")) osName = "Linux";

      const isMobile = osName === "iOS" || osName === "Android" || /Mobi|Android/i.test(userAgent);

      const devicePayload = {
        deviceCategory: isMobile ? "mobile" : "desktop",
        browser: browserName,
        os: osName,
        language: nav.language || "en",
        screenResolution: win.screen ? `${win.screen.width}x${win.screen.height}` : "1920x1080",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        storageAvailable: true,
      };

      const payload = {
        visitor_id: visitorId,
        event_type: eventType,
        timestamp: eventData.timestamp || new Date().toISOString(),
        page_url: href,
        product_id:
          eventData.data?.productVariant?.product?.id ||
          eventData.data?.checkout?.lineItems?.[0]?.variant?.product?.id,
        variant_id: eventData.data?.productVariant?.id,
        collection_id: eventData.data?.collection?.id,
        cart_id: eventData.data?.cart?.id || eventData.data?.checkout?.id,
        device: devicePayload,
        metadata: {
          clientId: eventData.clientId,
          device: devicePayload,
          ...eventData.data,
        },
      };

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-shopify-shop-domain": shopDomain,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  analytics.subscribe("page_viewed", (e) => sendEvent("page_viewed", e));
  analytics.subscribe("product_viewed", (e) => sendEvent("product_viewed", e));
  analytics.subscribe("collection_viewed", (e) => sendEvent("collection_viewed", e));
  analytics.subscribe("search_submitted", (e) => sendEvent("search_submitted", e));
  analytics.subscribe("product_added_to_cart", (e) => sendEvent("product_added_to_cart", e));
  analytics.subscribe("cart_viewed", (e) => sendEvent("cart_viewed", e));
  analytics.subscribe("checkout_started", (e) => sendEvent("checkout_started", e));
  analytics.subscribe("checkout_completed", (e) => sendEvent("checkout_completed", e));
});
