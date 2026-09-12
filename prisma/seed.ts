import { JurisdictionType, PrismaClient, TaxYearStatus } from '../lib/db/generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * DoPayCheck — foundational seed.
 *
 * ===========================================================================
 * THIS FILE CONTAINS NO TAX DATA. NOT ONE RATE, BRACKET, THRESHOLD OR WAGE BASE.
 *
 * What it seeds:
 *   - The federal jurisdiction and the states/territories, as REFERENCE GEOGRAPHY
 *     (names, USPS codes, hierarchy). These are administrative facts, not tax values.
 *   - One tax-year container in PREPARATION status, holding no rules.
 *
 * What it deliberately does NOT seed (spec §2, §19; CLAUDE.md §4):
 *   - tax brackets, rates, wage bases, thresholds
 *   - state or local tax values
 *   - withholding tables
 *   - sources (a fabricated source URL would be worse than none)
 *
 * Every tax value arrives later through the verified draft → review → approve → publish
 * workflow, traceable to an official document. Seeding a placeholder would put an unsourced
 * number into the system, which is exactly what the specification forbids.
 * ===========================================================================
 *
 * Idempotent: safe to re-run. Uses upsert throughout, so it never overwrites rule data.
 */

const FEDERAL_CODE = 'US';

/** USPS state/territory codes and names. Reference geography — no tax content. */
const STATES: readonly (readonly [code: string, name: string, slug: string])[] = [
  ['AL', 'Alabama', 'alabama'],
  ['AK', 'Alaska', 'alaska'],
  ['AZ', 'Arizona', 'arizona'],
  ['AR', 'Arkansas', 'arkansas'],
  ['CA', 'California', 'california'],
  ['CO', 'Colorado', 'colorado'],
  ['CT', 'Connecticut', 'connecticut'],
  ['DE', 'Delaware', 'delaware'],
  ['DC', 'District of Columbia', 'district-of-columbia'],
  ['FL', 'Florida', 'florida'],
  ['GA', 'Georgia', 'georgia'],
  ['HI', 'Hawaii', 'hawaii'],
  ['ID', 'Idaho', 'idaho'],
  ['IL', 'Illinois', 'illinois'],
  ['IN', 'Indiana', 'indiana'],
  ['IA', 'Iowa', 'iowa'],
  ['KS', 'Kansas', 'kansas'],
  ['KY', 'Kentucky', 'kentucky'],
  ['LA', 'Louisiana', 'louisiana'],
  ['ME', 'Maine', 'maine'],
  ['MD', 'Maryland', 'maryland'],
  ['MA', 'Massachusetts', 'massachusetts'],
  ['MI', 'Michigan', 'michigan'],
  ['MN', 'Minnesota', 'minnesota'],
  ['MS', 'Mississippi', 'mississippi'],
  ['MO', 'Missouri', 'missouri'],
  ['MT', 'Montana', 'montana'],
  ['NE', 'Nebraska', 'nebraska'],
  ['NV', 'Nevada', 'nevada'],
  ['NH', 'New Hampshire', 'new-hampshire'],
  ['NJ', 'New Jersey', 'new-jersey'],
  ['NM', 'New Mexico', 'new-mexico'],
  ['NY', 'New York', 'new-york'],
  ['NC', 'North Carolina', 'north-carolina'],
  ['ND', 'North Dakota', 'north-dakota'],
  ['OH', 'Ohio', 'ohio'],
  ['OK', 'Oklahoma', 'oklahoma'],
  ['OR', 'Oregon', 'oregon'],
  ['PA', 'Pennsylvania', 'pennsylvania'],
  ['RI', 'Rhode Island', 'rhode-island'],
  ['SC', 'South Carolina', 'south-carolina'],
  ['SD', 'South Dakota', 'south-dakota'],
  ['TN', 'Tennessee', 'tennessee'],
  ['TX', 'Texas', 'texas'],
  ['UT', 'Utah', 'utah'],
  ['VT', 'Vermont', 'vermont'],
  ['VA', 'Virginia', 'virginia'],
  ['WA', 'Washington', 'washington'],
  ['WV', 'West Virginia', 'west-virginia'],
  ['WI', 'Wisconsin', 'wisconsin'],
  ['WY', 'Wyoming', 'wyoming'],
];

/**
 * Tax-year containers to create. Empty shells only — no rules, no values.
 * Listing more than one year demonstrates that nothing is pinned to a single year.
 */
const TAX_YEARS: readonly number[] = [2025, 2026, 2027];

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL must be set to run the seed');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const federal = await prisma.jurisdiction.upsert({
      where: { code: FEDERAL_CODE },
      update: {},
      create: {
        code: FEDERAL_CODE,
        slug: 'federal',
        name: 'United States (Federal)',
        type: JurisdictionType.FEDERAL,
        notes: 'Root jurisdiction. Reference geography only — contains no tax values.',
      },
    });

    for (const [stateCode, name, slug] of STATES) {
      await prisma.jurisdiction.upsert({
        where: { code: `US-${stateCode}` },
        update: {},
        create: {
          code: `US-${stateCode}`,
          slug,
          name,
          type: JurisdictionType.STATE,
          parentId: federal.id,
          stateCode,
        },
      });
    }

    for (const year of TAX_YEARS) {
      await prisma.taxYear.upsert({
        where: { year },
        update: {},
        create: {
          year,
          status: TaxYearStatus.PREPARATION,
          // Calendar-year period. Stored explicitly rather than assumed.
          startDate: new Date(Date.UTC(year, 0, 1)),
          endDate: new Date(Date.UTC(year + 1, 0, 1)),
          notes: 'Container created by seed. No tax rules — all values PENDING DATA.',
        },
      });
    }

    const jurisdictions = await prisma.jurisdiction.count();
    const taxYears = await prisma.taxYear.count();
    const taxRules = await prisma.taxRule.count();

    console.log(
      `Seed complete: ${String(jurisdictions)} jurisdictions, ${String(taxYears)} tax years, ` +
        `${String(taxRules)} tax rules (expected 0 — no tax data is ever seeded).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
