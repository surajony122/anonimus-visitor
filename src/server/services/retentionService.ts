import { prisma } from '../db/client';

export class RetentionService {
  /**
   * Purges old events and un-identified visitors older than shop's retention window (e.g. 30, 60, 90, 180, 365 days)
   */
  public static async purgeExpiredData(shopId: string) {
    const settings = await prisma.privacySetting.findUnique({
      where: { shopId },
    });

    const retentionDays = settings?.retentionDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Delete events older than cutoff date
    const deletedEvents = await prisma.event.deleteMany({
      where: {
        shopId,
        timestamp: { lt: cutoffDate },
      },
    });

    // Delete anonymous visitors with no activity after cutoff date
    const deletedAnonymousVisitors = await prisma.visitor.deleteMany({
      where: {
        shopId,
        status: 'anonymous',
        lastSeenAt: { lt: cutoffDate },
      },
    });

    return {
      shopId,
      retentionDays,
      cutoffDate,
      deletedEventsCount: deletedEvents.count,
      deletedVisitorsCount: deletedAnonymousVisitors.count,
    };
  }

  /**
   * Complete GDPR/Privacy erasure of a single visitor's data
   */
  public static async deleteVisitorData(shopId: string, visitorId: string) {
    // Delete all events
    await prisma.event.deleteMany({
      where: { shopId, visitorId },
    });

    // Delete all storefront sessions
    await prisma.storefrontSession.deleteMany({
      where: { shopId, visitorId },
    });

    // Delete all identities
    await prisma.identity.deleteMany({
      where: { shopId, visitorId },
    });

    // Delete customer links
    await prisma.visitorCustomerLink.deleteMany({
      where: { shopId, visitorId },
    });

    // Delete audit logs
    await prisma.identityAuditLog.deleteMany({
      where: { shopId, visitorId },
    });

    // Delete visitor record
    const deleted = await prisma.visitor.deleteMany({
      where: { shopId, visitorId },
    });

    return {
      success: true,
      visitorId,
      deletedRecords: deleted.count,
    };
  }
}
