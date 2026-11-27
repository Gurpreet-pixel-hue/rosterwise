import { PrismaClient } from "@prisma/client";
import { withPgBouncer } from "./dbUrl";

// One client per server process (Next.js hot reload would otherwise open a new pool on every edit).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: withPgBouncer(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
