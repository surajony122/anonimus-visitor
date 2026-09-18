import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import ongThemeStyles from "../styles/ong-theme.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: ongThemeStyles }
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("DEBUG APP LOADER ERROR:", error);
  }
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "d5b0bf6a64d665d76769762be18281fd" });
};

import polarisTranslations from "@shopify/polaris/locales/en.json";
import { SkeletonTable, SkeletonKpiCards } from "../components/SkeletonLoader";

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} i18n={polarisTranslations}>
      {isNavigating && <div className="nitro-preloader-bar" />}
      <NavMenu>
        <Link to="/app" rel="home">Overview</Link>
        <Link to="/app/funnel">Funnel &amp; Campaigns</Link>
        <Link to="/app/visitors">Storefront Visitors</Link>
        <Link to="/app/customers">Shopify Customers</Link>
        <Link to="/app/intent">Intent Intelligence</Link>
        <Link to="/app/integrations">Marketing Webhooks</Link>
        <Link to="/app/privacy">Privacy Center</Link>
        <Link to="/app/simulator">Interactive Simulator</Link>
      </NavMenu>
      <div key={navigation.location?.pathname || "nitro-page"} className="nitro-page-container">
        {isNavigating ? (
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <SkeletonKpiCards count={4} />
            <SkeletonTable rows={8} columns={7} />
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError() as any;
  console.error("DEBUG APP ERROR:", error);

  return (
    <div style={{ padding: "30px", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: "#fff4f4", border: "1px solid #fecaca", borderRadius: "8px", padding: "20px", maxWidth: "800px" }}>
        <h2 style={{ color: "#b91c1c", margin: "0 0 10px 0" }}>⚠️ Application Encountered an Error</h2>
        <p style={{ color: "#374151", margin: "0 0 15px 0" }}>
          <strong>Error Message:</strong> {error?.message || error?.statusText || "Unexpected Server Error"}
        </p>
        {error?.stack && (
          <details style={{ marginTop: "10px" }}>
            <summary style={{ cursor: "pointer", color: "#4b5563" }}>View technical details / stack trace</summary>
            <pre style={{ background: "#1f2937", color: "#f9fafb", padding: "12px", borderRadius: "6px", overflowX: "auto", fontSize: "11px", marginTop: "8px" }}>
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
