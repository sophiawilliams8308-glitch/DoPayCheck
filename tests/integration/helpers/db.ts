import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';

import { JurisdictionType, PrismaClient, TaxYearStatus } from '@/lib/db/generated/client';

/**
 * Integration-test database helper.
 *
 * Builds its own PrismaClient rather than reusing `lib/db/client.ts`, so tests are not
 * affected by the module-level environment caching that production code relies on.
 *
 * SKIPPING: when DATABASE_URL is unset these suites skip rather than fail, so `npm test`
 * still works on a machine without PostgreSQL. `npm run test:db` runs them explicitly, and
 * the Phase 2 report states how many actually executed against a live database.
 */

export const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
export const hasDatabase = DATABASE_URL !== '';

let client: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  if (client === undefined) {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  }
  return client;
}

export async function disconnect(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}

/** Unique suffix so concurrently running test files never collide on unique columns. */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

/** Creates a throwaway jurisdiction owned by one test. */
export async function createTestJurisdiction(
  suffix: string,
  overrides: Partial<{ type: JurisdictionType; parentId: string; stateCode: string }> = {},
): Promise<{ id: string; code: string }> {
  const created = await testPrisma().jurisdiction.create({
    data: {
      code: `TEST-${suffix}`,
      slug: `test-${suffix}`,
      name: `Test Jurisdiction ${suffix}`,
      type: overrides.type ?? JurisdictionType.FEDERAL,
      ...(overrides.parentId === undefined ? {} : { parentId: overrides.parentId }),
      ...(overrides.stateCode === undefined ? {} : { stateCode: overrides.stateCode }),
    },
    select: { id: true, code: true },
  });
  return created;
}

/** Creates a throwaway tax year. Uses a far-future year so it cannot clash with seed data. */
export async function createTestTaxYear(year: number): Promise<{ id: number; year: number }> {
  return testPrisma().taxYear.create({
    data: {
      year,
      status: TaxYearStatus.DRAFT,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year + 1, 0, 1)),
    },
    select: { id: true, year: true },
  });
}

/** Removes rows created by a test, in dependency order. AuditLog is never deleted. */
export async function cleanupBySuffix(suffix: string): Promise<void> {
  const prisma = testPrisma();
  await prisma.taxRule.deleteMany({ where: { ruleKey: { contains: suffix } } });
  await prisma.source.deleteMany({ where: { code: { contains: suffix } } });
  await prisma.jurisdiction.deleteMany({ where: { code: { contains: suffix } } });
}
