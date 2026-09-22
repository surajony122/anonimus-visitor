import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import mysql from "mysql2/promise";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const hostingerUrl = url.searchParams.get("target");

  if (!hostingerUrl) {
    return json({
      message: "Ready to migrate data from Render to Hostinger.",
      instructions: "Pass your Hostinger MySQL URL as ?target=mysql://user:pass@host:3306/db or submit via POST."
    });
  }

  return runMigration(hostingerUrl);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.json().catch(() => ({}));
  const hostingerUrl = body.targetUrl || new URL(request.url).searchParams.get("target");

  if (!hostingerUrl) {
    return json({ error: "Missing target Hostinger connection URL" }, { status: 400 });
  }

  return runMigration(hostingerUrl);
};

async function runMigration(hostingerUrl: string) {
  let mysqlConn: mysql.Connection | null = null;

  try {
    console.log("Connecting to Hostinger MySQL...");
    mysqlConn = await mysql.createConnection(hostingerUrl);
    console.log("Connected to Hostinger MySQL successfully!");

    // 1. Ensure Hostinger MySQL tables exist
    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS Session (
        id VARCHAR(191) PRIMARY KEY,
        shop VARCHAR(191) NOT NULL,
        state VARCHAR(191) NOT NULL,
        isOnline BOOLEAN NOT NULL DEFAULT false,
        scope VARCHAR(191) NULL,
        expires DATETIME NULL,
        accessToken TEXT NOT NULL,
        userId BIGINT NULL,
        firstName VARCHAR(191) NULL,
        lastName VARCHAR(191) NULL,
        email VARCHAR(191) NULL,
        accountOwner BOOLEAN NOT NULL DEFAULT false,
        locale VARCHAR(191) NULL,
        collaborator BOOLEAN NULL DEFAULT false,
        emailVerified BOOLEAN NULL DEFAULT false
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS Shop (
        id VARCHAR(191) PRIMARY KEY,
        shopifyShopId VARCHAR(191) NULL,
        shopDomain VARCHAR(191) NOT NULL UNIQUE,
        accessTokenReference VARCHAR(191) NULL,
        installedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        uninstalledAt DATETIME NULL,
        settings TEXT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_shop_domain (shopDomain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS Visitor (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        visitorId VARCHAR(191) NOT NULL,
        status VARCHAR(191) NOT NULL DEFAULT 'anonymous',
        firstSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        firstSource VARCHAR(191) NULL,
        lastSource VARCHAR(191) NULL,
        deviceCategory VARCHAR(191) NULL,
        metadata TEXT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_shop_visitor (shopId, visitorId),
        INDEX idx_visitor_status (status),
        INDEX idx_visitor_lastseen (lastSeenAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS StorefrontSession (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        visitorId VARCHAR(191) NOT NULL,
        startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lastActivityAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endedAt DATETIME NULL,
        landingPage TEXT NULL,
        referrer TEXT NULL,
        utmSource VARCHAR(191) NULL,
        utmMedium VARCHAR(191) NULL,
        utmCampaign VARCHAR(191) NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session_visitor (shopId, visitorId),
        INDEX idx_session_started (startedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS Event (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        visitorId VARCHAR(191) NOT NULL,
        sessionId VARCHAR(191) NULL,
        eventId VARCHAR(191) NOT NULL UNIQUE,
        eventType VARCHAR(191) NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        pageUrl TEXT NULL,
        productId VARCHAR(191) NULL,
        variantId VARCHAR(191) NULL,
        collectionId VARCHAR(191) NULL,
        cartId VARCHAR(191) NULL,
        metadata TEXT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_evt_type (eventType),
        INDEX idx_evt_time (timestamp),
        INDEX idx_evt_prod (productId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS Identity (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        visitorId VARCHAR(191) NOT NULL,
        identityType VARCHAR(191) NOT NULL,
        identityValueHash VARCHAR(191) NOT NULL,
        identityValueEncrypted TEXT NULL,
        source VARCHAR(191) NOT NULL,
        confidenceScore INT NOT NULL DEFAULT 100,
        verified BOOLEAN NOT NULL DEFAULT true,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_shop_ident (shopId, identityType, identityValueHash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS ShopifyCustomer (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        shopifyCustomerId VARCHAR(191) NOT NULL,
        emailReference VARCHAR(191) NULL,
        phoneReference VARCHAR(191) NULL,
        firstName VARCHAR(191) NULL,
        lastName VARCHAR(191) NULL,
        ordersCount INT NOT NULL DEFAULT 0,
        totalSpent DOUBLE NOT NULL DEFAULT 0.0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_shop_cust (shopId, shopifyCustomerId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlConn.execute(`
      CREATE TABLE IF NOT EXISTS VisitorCustomerLink (
        id VARCHAR(191) PRIMARY KEY,
        shopId VARCHAR(191) NOT NULL,
        visitorId VARCHAR(191) NOT NULL,
        shopifyCustomerId VARCHAR(191) NOT NULL,
        matchMethod VARCHAR(191) NOT NULL,
        confidenceScore INT NOT NULL DEFAULT 100,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_link (shopId, visitorId, shopifyCustomerId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Fetch all data from Render database
    const [shops, visitors, sessions, events, identities, customers, links] = await Promise.all([
      prisma.shop.findMany().catch(() => []),
      prisma.visitor.findMany().catch(() => []),
      prisma.storefrontSession.findMany().catch(() => []),
      prisma.event.findMany().catch(() => []),
      prisma.identity.findMany().catch(() => []),
      prisma.shopifyCustomer.findMany().catch(() => []),
      prisma.visitorCustomerLink.findMany().catch(() => []),
    ]);

    const stats = {
      shops: shops.length,
      visitors: visitors.length,
      sessions: sessions.length,
      events: events.length,
      identities: identities.length,
      customers: customers.length,
      links: links.length,
    };

    // 3. Batch insert into Hostinger MySQL
    for (const s of shops) {
      await mysqlConn.execute(
        `INSERT INTO Shop (id, shopifyShopId, shopDomain, accessTokenReference, installedAt, settings) 
         VALUES (?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE settings = VALUES(settings)`,
        [s.id, s.shopifyShopId, s.shopDomain, s.accessTokenReference, s.installedAt, s.settings]
      );
    }

    for (const v of visitors) {
      await mysqlConn.execute(
        `INSERT INTO Visitor (id, shopId, visitorId, status, firstSeenAt, lastSeenAt, firstSource, lastSource, deviceCategory, metadata) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE lastSeenAt = VALUES(lastSeenAt), status = VALUES(status), metadata = VALUES(metadata)`,
        [v.id, v.shopId, v.visitorId, v.status, v.firstSeenAt, v.lastSeenAt, v.firstSource, v.lastSource, v.deviceCategory, v.metadata]
      );
    }

    for (const sess of sessions) {
      await mysqlConn.execute(
        `INSERT INTO StorefrontSession (id, shopId, visitorId, startedAt, lastActivityAt, endedAt, landingPage, referrer, utmSource, utmMedium, utmCampaign) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE lastActivityAt = VALUES(lastActivityAt)`,
        [sess.id, sess.shopId, sess.visitorId, sess.startedAt, sess.lastActivityAt, sess.endedAt, sess.landingPage, sess.referrer, sess.utmSource, sess.utmMedium, sess.utmCampaign]
      );
    }

    for (const ev of events) {
      await mysqlConn.execute(
        `INSERT INTO Event (id, shopId, visitorId, sessionId, eventId, eventType, timestamp, pageUrl, productId, variantId, collectionId, cartId, metadata) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE eventType = VALUES(eventType)`,
        [ev.id, ev.shopId, ev.visitorId, ev.sessionId, ev.eventId, ev.eventType, ev.timestamp, ev.pageUrl, ev.productId, ev.variantId, ev.collectionId, ev.cartId, ev.metadata]
      );
    }

    for (const ident of identities) {
      await mysqlConn.execute(
        `INSERT INTO Identity (id, shopId, visitorId, identityType, identityValueHash, identityValueEncrypted, source, confidenceScore, verified) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE verified = VALUES(verified)`,
        [ident.id, ident.shopId, ident.visitorId, ident.identityType, ident.identityValueHash, ident.identityValueEncrypted, ident.source, ident.confidenceScore, ident.verified]
      );
    }

    for (const c of customers) {
      await mysqlConn.execute(
        `INSERT INTO ShopifyCustomer (id, shopId, shopifyCustomerId, emailReference, phoneReference, firstName, lastName, ordersCount, totalSpent) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE ordersCount = VALUES(ordersCount), totalSpent = VALUES(totalSpent)`,
        [c.id, c.shopId, c.shopifyCustomerId, c.emailReference, c.phoneReference, c.firstName, c.lastName, c.ordersCount, c.totalSpent]
      );
    }

    return json({
      success: true,
      message: "Data successfully migrated from Render to Hostinger MySQL!",
      migratedRecords: stats,
    });
  } catch (error: any) {
    console.error("Migration error:", error);
    return json({
      success: false,
      error: error.message,
    }, { status: 500 });
  } finally {
    if (mysqlConn) await mysqlConn.end().catch(() => {});
  }
}
