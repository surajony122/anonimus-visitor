import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
  BlockStack,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = await login(request);
  return json({ errors });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = await login(request);
  return json({ errors });
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = (actionData as any)?.errors || (loaderData as any)?.errors;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Log in to Storefront Visitor Intelligence
            </Text>
            <Form method="post">
              <FormLayout>
                <TextField
                  type="text"
                  name="shop"
                  label="Shop domain"
                  helpText="e.g. ravistore-shop.myshopify.com"
                  value={shop}
                  onChange={setShop}
                  autoComplete="on"
                  error={errors?.shop}
                />
                <Button submit variant="primary">
                  Log in
                </Button>
              </FormLayout>
            </Form>
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>
  );
}
