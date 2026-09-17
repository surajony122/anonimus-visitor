import { PrismaClient } from "@prisma/client";

// Polyfill BigInt JSON serialization
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error"],
  });

globalForPrisma.prisma = prisma;

export default prisma;
