import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PayFrequency } from '@/lib/db/generated/client';
import { CalculationStatus, GENERIC_CURRENCY_POLICY, calculatePaycheck } from '@/lib/calculator';
import {
  PAY_FREQUENCIES,
  hasFixedPeriods,
  periodsPerYear,
} from '@/lib/calculator/pipeline/pay-frequency';
import {
  EMPLOYER_COMPONENTS,
  FEDERAL_COMPONENTS,
  FICA_COMPONENTS,
  LOCAL_COMPONENTS,
  STATE_COMPONENTS,
} from '@/lib/calculator/pipeline/tax-stages';
import { calculationInputSchema } from '@/lib/calculator/validation/input-schema';
import type { CalculationInput } from '@/lib/calculator/types/input';

/**
 * Enum runtime-safety regression tests.
 *
 * ===========================================================================
 * THE BUG THESE EXIST TO CATCH
 *
 *   TypeError: Cannot read properties of undefined (reading 'WEEKLY')
 *
 * The engine used to build lookup tables from the Prisma-generated client's RUNTIME enum
 * objects (`PayFrequency.WEEKLY`, `RuleCategory.SOCIAL_SECURITY`). Those objects reach the
 * engine through CommonJS/ESM interop, which is not guaranteed to expose named exports
 * identically on every toolchain — and a type-only check cannot see the difference, because
 * the TYPE resolves even when the runtime VALUE does not.
 *
 * The engine now uses string literals checked against the Prisma types, so nothing is read
 * off a runtime enum object at module load.
 * ===========================================================================
 *
 * The authoritative member names are read from `prisma/schema.prisma` itself, so these tests
 * assume no enum member and cannot drift from the schema.
 *
 * NO TAX VALUES — the scenarios below carry no rules at all.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Reads one enum's members straight out of the authoritative Prisma schema. */
function schemaEnumMembers(name: string): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`enum ${name} not found in prisma/schema.prisma`);
  }
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('@'));
}

/** Every TypeScript source file in the calculation engine. */
function engineSourceFiles(dir: string = join(ROOT, 'lib/calculator')): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return engineSourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function inputWith(payFrequency: string): CalculationInput {
  return {
    taxYear: 2099,
    effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
    employee: { workLocation: { stateCode: 'US-ZZ' } },
    pay: {
      basis: 'SALARY',
      payFrequency: payFrequency as PayFrequency,
      annualSalary: '52000.00',
      periodsPerYear: 260,
    },
    w4: { filingStatus: 'TEST_STATUS' },
  };
}

describe('PayFrequency runtime safety', () => {
  it('the engine table covers EXACTLY the schema PayFrequency enum', () => {
    expect([...PAY_FREQUENCIES].sort()).toEqual(schemaEnumMembers('PayFrequency').sort());
  });

  it('every schema PayFrequency resolves at runtime, with no undefined lookup', () => {
    const members = schemaEnumMembers('PayFrequency');
    expect(members.length).toBeGreaterThan(0);

    for (const member of members) {
      const frequency = member as PayFrequency;
      const result = periodsPerYear(frequency);

      if (result.known) {
        expect(Number.isInteger(result.periods)).toBe(true);
        expect(result.periods).toBeGreaterThan(0);
        expect(hasFixedPeriods(frequency)).toBe(true);
      } else {
        // Undecided is a stated outcome, never a crash and never a guessed count.
        expect(result.reason).toContain('periodsPerYear');
        expect(hasFixedPeriods(frequency)).toBe(false);
      }
    }
  });

  it('input validation accepts every schema PayFrequency and rejects an unknown one', () => {
    for (const member of schemaEnumMembers('PayFrequency')) {
      expect(calculationInputSchema.safeParse(inputWith(member)).success).toBe(true);
    }
    expect(calculationInputSchema.safeParse(inputWith('FORTNIGHTLY')).success).toBe(false);
  });

  it('calculatePaycheck runs for every schema PayFrequency without an engine error', () => {
    for (const member of schemaEnumMembers('PayFrequency')) {
      const result = calculatePaycheck(inputWith(member), {
        rounding: GENERIC_CURRENCY_POLICY,
        rules: { byCategory: {} },
      });
      expect(result.status).not.toBe(CalculationStatus.CALCULATION_ERROR);
      expect(result.status).not.toBe(CalculationStatus.INVALID_INPUT);
      expect(result.payFrequency).toBe(member);
    }
  });
});

describe('RuleCategory runtime safety', () => {
  it('every tax component category is a member of the schema RuleCategory enum', () => {
    const members = new Set(schemaEnumMembers('RuleCategory'));
    const components = [
      ...FEDERAL_COMPONENTS,
      ...FICA_COMPONENTS,
      ...STATE_COMPONENTS,
      ...LOCAL_COMPONENTS,
      ...EMPLOYER_COMPONENTS,
    ];

    expect(components.length).toBeGreaterThan(0);
    for (const component of components) {
      expect({ code: component.code, known: members.has(component.category) }).toEqual({
        code: component.code,
        known: true,
      });
    }
  });
});

describe('engine independence from the generated Prisma client', () => {
  it('no engine module imports a RUNTIME value from the generated client', () => {
    // `import type { … }` is fine — it is erased. A value import is what breaks under interop.
    const valueImport = /^import\s+\{[^}]*\}\s+from\s+'@\/lib\/db\/generated/m;

    const offenders = engineSourceFiles()
      .filter((file) => valueImport.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});
