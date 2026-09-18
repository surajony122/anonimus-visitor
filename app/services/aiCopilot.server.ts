import https from "https";

export interface StoreContextSummary {
  shopDomain?: string;
  currency?: string;
  timeRange?: string;
  totalVisitors?: number;
  totalSessions?: number;
  totalEvents?: number;
  funnel?: {
    visitors: number;
    pdpViews: number;
    cartAdds: number;
    checkouts: number;
    purchases: number;
    pdpRate: string;
    cartRate: string;
    checkoutRate: string;
    purchaseRate: string;
  };
  metrics?: {
    ordersCount: number;
    totalRevenue: number;
    aov: number;
    totalDiscountsGiven: number;
  };
  topCollections?: Array<{ title: string; views: number; addToCarts: number; revenue: number }>;
  topLeakingProducts?: Array<{ title: string; views: number; addToCarts: number; purchases: number; dropRate: string }>;
  winningProducts?: Array<{ title: string; views: number; purchases: number; convRate: string }>;
  devices?: Array<{ device: string; visitors: number; share: string }>;
  offers?: Array<{ code: string; orders: number; revenue: number; discount: number }>;
}

export interface ChatMessage {
  role: "user" | "model" | "assistant";
  content: string;
}

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || "";

async function queryGemini(model: string, apiKey: string, prompt: string, history: ChatMessage[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const contents: any[] = [];

    for (const msg of history.slice(-6)) {
      contents.push({
        role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    }

    contents.push({
      role: "user",
      parts: [{ text: prompt }]
    });

    const payload = JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 15000
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              resolve(text);
              return;
            }
          }
          reject(new Error(`Gemini API error (${res.statusCode}): ${data}`));
        } catch (e: any) {
          reject(new Error(`Failed to parse Gemini response: ${e.message}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Gemini API request timed out"));
    });

    req.write(payload);
    req.end();
  });
}

function buildSystemPrompt(context: StoreContextSummary, userQuery: string): string {
  const curr = context.currency === "INR" || !context.currency ? "₹" : context.currency;
  return `You are the Nitro AI Chief Merchant Analyst & E-Commerce Growth Strategist for this Shopify store (${context.shopDomain || "Live Store"}).
You have REAL-TIME access to live store tracking data, checkout funnels, product trends, promo discount redemptions, and device matrices.

### CURRENT LIVE STORE METRICS & ANALYTICS:
- Store Currency: ${context.currency || "INR"}
- Timeframe Selected: ${context.timeRange || "Today / All-time"}
- Total Unique Visitors Tracked: ${context.totalVisitors || 0}
- Total Sessions: ${context.totalSessions || 0}
- Total Tracking Events: ${context.totalEvents || 0}

#### 🎯 CONVERSION FUNNEL METRICS:
- Total Store Visitors: ${context.funnel?.visitors || 0} (100%)
- Product Page (PDP) Views: ${context.funnel?.pdpViews || 0} (${context.funnel?.pdpRate || "0%"} of visitors)
- Added to Cart: ${context.funnel?.cartAdds || 0} (${context.funnel?.cartRate || "0%"} of PDP views)
- Initiated Checkout: ${context.funnel?.checkouts || 0} (${context.funnel?.checkoutRate || "0%"} of Cart adds)
- Completed Orders: ${context.funnel?.purchases || 0} (${context.funnel?.purchaseRate || "0%"} of Checkouts)

#### 💰 FINANCIALS & ORDERS:
- Total Orders: ${context.metrics?.ordersCount || 0}
- Gross Revenue: ${curr}${(context.metrics?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Average Order Value (AOV): ${curr}${(context.metrics?.aov || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Total Discounts Given: ${curr}${(context.metrics?.totalDiscountsGiven || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

#### 🛍️ TOP COLLECTIONS & CATEGORIES:
${context.topCollections && context.topCollections.length > 0
  ? context.topCollections.map(c => `- ${c.title}: ${c.views} views, ${c.addToCarts} cart adds, ${curr}${c.revenue.toFixed(2)} sales`).join("\n")
  : "- No collection events yet or store in learning phase"}

#### ⚠️ TOP TRAFFIC-LEAKING PRODUCTS (High Views, Low Purchase/Cart):
${context.topLeakingProducts && context.topLeakingProducts.length > 0
  ? context.topLeakingProducts.map(p => `- ${p.title}: ${p.views} views, ${p.addToCarts} adds, ${p.purchases} sales (${p.dropRate} drop)`).join("\n")
  : "- No high-leak products identified yet"}

#### 🏆 TOP WINNING PRODUCTS:
${context.winningProducts && context.winningProducts.length > 0
  ? context.winningProducts.map(p => `- ${p.title}: ${p.views} views, ${p.purchases} sales (CVR: ${p.convRate})`).join("\n")
  : "- No winning products yet"}

#### 📱 DEVICE BREAKDOWN:
${context.devices && context.devices.length > 0
  ? context.devices.map(d => `- ${d.device}: ${d.visitors} visitors (${d.share})`).join("\n")
  : "- Mobile/Desktop data accumulating"}

#### 🎟️ ACTIVE OFFERS & PROMOS:
${context.offers && context.offers.length > 0
  ? context.offers.map(o => `- Code "${o.code}": ${o.orders} orders, ${curr}${o.revenue.toFixed(2)} rev, ${curr}${o.discount.toFixed(2)} discount`).join("\n")
  : "- No active discount promo redemptions recorded"}

---
### YOUR OBJECTIVES:
1. Always structure your response for ANY merchant question (whether a preset or custom typed) with actionable, deep, and grounded insights.
2. Structure your response with clean Markdown sections:
   - **📊 Key Performance Breakdown**: Give the specific numbers related to their question.
   - **🔍 Root-Cause Analysis**: Diagnose why visitors or products are behaving this way (funnel leaks, price resistance, mobile friction, category discovery).
   - **💡 Actionable Revenue Recommendations**: 2 to 4 high-ROI, concrete steps the merchant should take immediately.
   - **🚀 Projected Business Impact**: Realistic uplift estimate if recommendations are implemented.
3. Be friendly, authoritative, concise, and data-driven. Do NOT invent numbers that contradict the provided live data.

Merchant's Question: "${userQuery}"`;
}

export function generateAutonomousAnalysis(context: StoreContextSummary, userQuery: string): string {
  const visitors = context.funnel?.visitors || context.totalVisitors || 0;
  const pdpViews = context.funnel?.pdpViews || 0;
  const cartAdds = context.funnel?.cartAdds || 0;
  const checkouts = context.funnel?.checkouts || 0;
  const orders = context.funnel?.purchases || context.metrics?.ordersCount || 0;
  const revenue = context.metrics?.totalRevenue || 0;
  const aov = context.metrics?.aov || (orders > 0 ? revenue / orders : 0);

  const pdpRate = visitors > 0 ? ((pdpViews / visitors) * 100).toFixed(1) : "0.0";
  const cartRate = pdpViews > 0 ? ((cartAdds / pdpViews) * 100).toFixed(1) : "0.0";
  const checkoutRate = cartAdds > 0 ? ((checkouts / cartAdds) * 100).toFixed(1) : "0.0";
  const orderRate = checkouts > 0 ? ((orders / checkouts) * 100).toFixed(1) : "0.0";

  return `### 📊 Live Store Performance & Trend Analysis

**Store Overview & Funnel Status:**
- **Total Tracked Traffic:** **${visitors}** visitors across **${context.totalSessions || visitors}** sessions
- **Product Discovery (PDP Views):** **${pdpViews}** (${pdpRate}% discovery rate)
- **Cart Engagement:** **${cartAdds}** additions (${cartRate}% conversion from PDP)
- **Checkouts Initiated:** **${checkouts}** (${checkoutRate}% progression)
- **Completed Sales:** **${orders}** orders totaling **$${revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}** (AOV: **$${aov.toFixed(2)}**)

---

### 🔍 Funnel Bottlenecks & Leak Diagnosis:
1. **${parseFloat(pdpRate) < 50 ? "⚠️ Top-of-Funnel Drop-off" : "✅ Top-of-Funnel Discovery"}**: ${
    parseFloat(pdpRate) < 50 
      ? `Only ${pdpRate}% of visitors browse specific product detail pages. Homepage navigation or hero banners need clearer Category CTAs.`
      : `${pdpRate}% of visitors reach product pages, showing strong landing page relevance.`
  }
2. **${parseFloat(cartRate) < 15 ? "⚠️ Cart Addition Friction" : "✅ Healthy Add-to-Cart"}**: ${
    parseFloat(cartRate) < 15
      ? `Add-to-cart rate is ${cartRate}% (benchmark is 12-20%). Check for missing social proof, unclear shipping costs, or unoptimized CTA buttons on mobile.`
      : `Solid cart intent with ${cartRate}% conversion from viewed products.`
  }
3. **${parseFloat(orderRate) < 60 ? "⚠️ Checkout Abandonment" : "✅ High Checkout Completion"}**: ${
    parseFloat(orderRate) < 60
      ? `Checkout to Order rate is ${orderRate}%. Consider implementing 1-click Express Checkout (Shop Pay/Apple Pay) and exit-intent recovery.`
      : `High checkout efficiency at ${orderRate}%.`
  }

---

### 💡 High-ROI Growth Recommendations:
1. **Launch Automated Abandoned Cart Recovery**: Setup targeted Klaviyo / Omnisend flows for visitors who add items but drop before payment.
2. **Optimize Leaking Product PDPs**: Add high-res lifestyle imagery, size guides, and customer reviews to high-traffic PDPs.
3. **Bundle & Upsell to Boost AOV**: Introduce "Frequently Bought Together" widgets on product pages to increase average basket size from **$${aov.toFixed(2)}**.
4. **Offer First-Order Incentives**: Display a subtle exit-intent discount pop-up (e.g., *WELCOME10*) for high-intent visitors.

*Analyzed live by Nitro Autonomous Analytics Engine.*`;
}

export async function askAiCopilot(
  userQuery: string,
  context: StoreContextSummary,
  history: ChatMessage[] = [],
  customApiKey?: string
): Promise<{ reply: string; source: "gemini" | "autonomous"; modelUsed?: string }> {
  const apiKey = customApiKey?.trim() || DEFAULT_GEMINI_KEY;

  if (apiKey) {
    const models = [
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-3.7-flash",
      "gemini-3.8-flash",
      "gemini-3.6-flash",
    ];
    const prompt = buildSystemPrompt(context, userQuery);

    for (const model of models) {
      try {
        const text = await queryGemini(model, apiKey, prompt, history);
        if (text && text.trim().length > 0) {
          return {
            reply: text.trim(),
            source: "gemini",
            modelUsed: model,
          };
        }
      } catch (err: any) {
        console.warn(`[AI Copilot] Model ${model} failed, attempting next model...`, err.message);
      }
    }
  }

  return {
    reply: generateAutonomousAnalysis(context, userQuery),
    source: "autonomous",
    modelUsed: "Nitro Rule Engine"
  };
}
