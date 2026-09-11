import prisma from "../db.server";

export class RetentionService {
  public static async purgeExpiredData(shopId: string) {
    const settings = await prisma.privacySetting.findUnique({
      where: { shopId },
    });

    const retentionDays = settings?.retentionDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedEvents = await prisma.event.deleteMany({
      where: {
        shopId,
        timestamp: { lt: cutoffDate },
      },
    });

    const deletedAnonymousVisitors = await prisma.visitor.deleteMany({
      where: {
        shopId,
        status: "anonymous",
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

  public static async deleteVisitorData(shopId: string, visitorId: string) {
    await prisma.event.deleteMany({ where: { shopId, visitorId } });
    await prisma.storefrontSession.deleteMany({ where: { shopId, visitorId } });
    await prisma.identity.deleteMany({ where: { shopId, visitorId } });
    await prisma.visitorCustomerLink.deleteMany({ where: { shopId, visitorId } });
    await prisma.identityAuditLog.deleteMany({ where: { shopId, visitorId } });

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
