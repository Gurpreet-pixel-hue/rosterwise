import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../../../prisma/seed-lib";
import { testDatabaseUrl } from "./testDb";

export const TEST_URL = testDatabaseUrl();
export const HAS_DB = TEST_URL !== null;

let client: PrismaClient | undefined;

/** A client bound to the test database (never to DATABASE_URL). */
export function testPrisma(): PrismaClient {
  if (!TEST_URL) throw new Error("TEST_DATABASE_URL is not set");
  client ??= new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  return client;
}

/** Wipe the test database and load the demo seed (rosters, acknowledgements and audit log included). */
export const resetDb = () => seedDatabase(testPrisma());

export async function closeDb() {
  await client?.$disconnect();
  client = undefined;
}

export const DEC = "2026-12";
export const ANANYA = "emp-ananya-reddy";
