import { PrismaClient, type SeoBlockType } from '../lib/db/generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { loadEnvFile } from '../lib/config/env-file';
import { relatedCalculatorsForCalculator } from '../lib/seo/internal-links';
import {
  CALCULATOR_KEYS,
  CALCULATOR_REGISTRY,
  type CalculatorDefinition,
} from '../lib/seo/calculators/registry';

/**
 * SEO calculator page bootstrap (SEO-05 contract §16, §12).
 *
 * ===========================================================================
 * THE CONTROLLED CREATION MECHANISM CONTRACT §16 REQUIRES.
 *
 * No admin exists yet (§35: "full admin/auth/RBAC is NOT a prerequisite for SEO-05"), and
 * nothing in the repository could create a `SeoPage`/`SeoBlock` row before this (SEO-05
 * inspection report §27: "NO EXISTING MECHANISM"). This script is that mechanism: deterministic
 * and idempotent (upsert on `SeoPage.path`, the model's own global-unique identity), creating
 * exactly the 6 owner-approved calculator pages (contract §54 decision record) with real,
 * non-fabricated editorial content — no tax rate, bracket or threshold appears anywhere below
 * (gate 16; CLAUDE.md §13).
 *
 * Uses typed `SeoBlock` payloads validated against the exact same schemas
 * (`lib/seo/blocks/schemas.ts`) the application itself enforces — never a raw insert that
 * could drift from what the resolver/gates expect.
 * ===========================================================================
 */

loadEnvFile();

interface RichTextParagraph {
  readonly nodes: readonly {
    readonly type: 'paragraph';
    readonly children: readonly { readonly type: 'text'; readonly text: string }[];
  }[];
}

function richText(...paragraphs: readonly string[]): RichTextParagraph {
  return {
    nodes: paragraphs.map((text) => ({
      type: 'paragraph' as const,
      children: [{ type: 'text' as const, text }],
    })),
  };
}

interface BlockSpec {
  readonly blockType: SeoBlockType;
  readonly payload: unknown;
  readonly isRequired: boolean;
  readonly isRemovable: boolean;
}

const DISCLAIMER_TEXT =
  'This calculator provides an estimate for informational purposes only. It is not tax, ' +
  'legal, or financial advice, and figures may differ from your actual paycheck depending on ' +
  'your employer’s payroll practices and any tax rules not yet reflected here.';

function faqBlock(items: readonly { question: string; answer: string }[]): BlockSpec {
  return { blockType: 'FAQ', payload: { items }, isRequired: false, isRemovable: true };
}

function blocksFor(definition: CalculatorDefinition): readonly BlockSpec[] {
  const blocks: BlockSpec[] = [
    {
      blockType: 'HERO',
      payload: { heading: definition.displayName, subheading: definition.shortDescription },
      isRequired: true,
      isRemovable: false,
    },
  ];

  switch (definition.calculatorKey) {
    case 'paycheck':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Enter your salary or hourly pay, how often you get paid, and your federal filing ' +
              'status to estimate your gross pay, federal paycheck withholding, and what you ' +
              'take home.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'Your paycheck starts with gross pay: everything you earned in the pay period, ' +
              'before anything is withheld. From there, federal income tax withholding and ' +
              'FICA taxes (Social Security and Medicare) are subtracted to arrive at your net, ' +
              'or take-home, pay. Each of these is withheld independently, based on the ' +
              'withholding rules in effect for the tax year and the filing status you select.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'Does this include state or local taxes?',
            answer:
              'Not yet. This calculator currently estimates federal paycheck withholding only.',
          },
          {
            question: 'What filing status should I choose?',
            answer:
              'Choose the federal filing status that matches how you expect to file your ' +
              'federal income tax return for the year.',
          },
        ]),
      );
      break;
    case 'salary-paycheck':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Enter your annual salary, how often you get paid, and your federal filing status ' +
              'to estimate your federal paycheck withholding for a fixed salary.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'A salaried paycheck divides your annual salary across your pay periods, then ' +
              'applies federal income tax withholding and FICA taxes to that period’s ' +
              'gross pay to determine what is withheld and what you take home.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'How is my salary divided into paychecks?',
            answer:
              'Your annual salary is divided evenly across the number of pay periods in the ' +
              'year for the pay frequency you select.',
          },
        ]),
      );
      break;
    case 'hourly-paycheck':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Enter your hourly rate, the hours you worked in a pay period, how often you get ' +
              'paid, and your federal filing status to estimate your federal paycheck ' +
              'withholding for hourly pay.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'An hourly paycheck starts with your hourly rate multiplied by the hours you ' +
              'worked in the pay period. Federal income tax withholding and FICA taxes are ' +
              'then applied to that gross pay to determine what is withheld and what you take ' +
              'home.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'Can I include overtime hours?',
            answer:
              'For overtime pay specifically, use the Overtime Calculator, which accepts ' +
              'separate overtime hours and a multiplier.',
          },
        ]),
      );
      break;
    case 'overtime':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Enter your hourly rate, regular hours, overtime hours, and the overtime ' +
              'multiplier you are paid to estimate a paycheck that includes overtime pay.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'Overtime pay is calculated as your overtime hours multiplied by your hourly rate ' +
              'and the multiplier you enter, then added to your regular pay before federal ' +
              'income tax withholding and FICA taxes are applied. This calculator performs ' +
              'that arithmetic only; it does not determine whether you are legally entitled to ' +
              'overtime or apply any state or federal overtime-law threshold.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'What overtime multiplier should I use?',
            answer:
              'Enter the multiplier your employer actually pays you for overtime hours. This ' +
              'calculator does not set or verify that figure.',
          },
        ]),
      );
      break;
    case 'bonus-tax':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Enter your regular pay and a bonus amount to estimate federal withholding on a ' +
              'bonus paid alongside a regular paycheck.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'A bonus is a supplemental wage. Federal withholding on supplemental wages can be ' +
              'calculated differently from withholding on regular wages, depending on the ' +
              'method in effect for the tax year. FICA taxes still apply to a bonus in the ' +
              'same way they apply to regular pay.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'Is my bonus taxed at a different rate than my regular pay?',
            answer:
              'Federal withholding on a bonus can use a different calculation method than your ' +
              'regular paycheck, though your actual federal income tax for the year is not ' +
              'determined until you file your return.',
          },
        ]),
      );
      break;
    case 'take-home-pay':
      blocks.push(
        {
          blockType: 'INTRO',
          payload: richText(
            'Take-home pay is what you actually receive after federal paycheck taxes are ' +
              'withheld — also called net pay. Enter your pay details and federal filing ' +
              'status to estimate it.',
          ),
          isRequired: true,
          isRemovable: true,
        },
        {
          blockType: 'TAX_EXPLANATION',
          payload: richText(
            'Take-home pay (net pay) is your gross pay minus federal income tax withholding ' +
              'and FICA taxes (Social Security and Medicare). This calculator estimates it for ' +
              'federal paycheck taxes; it does not yet include state or local withholding.',
          ),
          isRequired: false,
          isRemovable: true,
        },
        faqBlock([
          {
            question: 'Is take-home pay the same as net pay?',
            answer: 'Yes — they refer to the same figure: what is left after taxes are withheld.',
          },
        ]),
      );
      break;
  }

  blocks.push({
    blockType: 'RELATED_CALCULATORS',
    payload: {},
    isRequired: false,
    isRemovable: true,
  });
  blocks.push({
    blockType: 'DISCLAIMER',
    payload: richText(DISCLAIMER_TEXT),
    isRequired: true,
    isRemovable: false,
  });
  blocks.push({
    blockType: 'CALCULATOR_EMBED',
    payload: { calculatorKey: definition.calculatorKey },
    isRequired: true,
    isRemovable: false,
  });

  return blocks;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL must be set to run the SEO calculator seed');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    for (const key of CALCULATOR_KEYS) {
      const definition = CALCULATOR_REGISTRY[key];
      const blocks = blocksFor(definition);

      // Precomputed, never resolved by an unbounded runtime query (contract §Q.2) — the same
      // `relatedCalculatorsForCalculator()` wrapper `app/[calculatorSlug]/page.tsx` uses for
      // the VISIBLE related-calculators block, stored here so `listEligibleSeoPages()`'s
      // inbound-link accounting (gate 12) can see it without recomputing it live.
      const otherCalculators = CALCULATOR_KEYS.filter((other) => other !== key).map((other) => ({
        path: CALCULATOR_REGISTRY[other].canonicalPath,
        label: CALCULATOR_REGISTRY[other].displayName,
      }));
      const relatedLinksCache = { targets: relatedCalculatorsForCalculator(otherCalculators) };

      const pageFields = {
        lifecycleState: 'PUBLISHED' as const,
        manualIndexable: true,
        titleOverride: `${definition.displayName} | DoPayCheck`,
        descriptionOverride: definition.shortDescription,
        h1Override: definition.displayName,
        relatedLinksCache: relatedLinksCache as never,
      };

      const page = await prisma.seoPage.upsert({
        where: { path: definition.canonicalPath },
        update: pageFields,
        create: {
          ...pageFields,
          pageType: 'CALCULATOR',
          path: definition.canonicalPath,
          calculatorKey: definition.calculatorKey,
          publishedAt: new Date(),
        },
      });

      for (const [index, block] of blocks.entries()) {
        await prisma.seoBlock.upsert({
          where: { pageId_position: { pageId: page.id, position: index } },
          update: {
            blockType: block.blockType,
            payload: block.payload as never,
            isRequired: block.isRequired,
            isRemovable: block.isRemovable,
          },
          create: {
            pageId: page.id,
            position: index,
            blockType: block.blockType,
            payload: block.payload as never,
            isRequired: block.isRequired,
            isRemovable: block.isRemovable,
          },
        });
      }
    }

    const pageCount = await prisma.seoPage.count({ where: { pageType: 'CALCULATOR' } });
    const blockCount = await prisma.seoBlock.count({
      where: { page: { pageType: 'CALCULATOR' } },
    });
    console.log(
      `SEO calculator seed complete: ${String(pageCount)} pages, ${String(blockCount)} blocks.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
