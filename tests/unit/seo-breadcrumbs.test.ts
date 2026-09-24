import { describe, expect, it } from 'vitest';

import { resolveBreadcrumbTrail } from '@/lib/seo/breadcrumbs';

describe('resolveBreadcrumbTrail (SEO-03 contract §P)', () => {
  it('HOME has no trail', () => {
    expect(resolveBreadcrumbTrail({ pageType: 'HOME', path: '/' })).toEqual([]);
  });

  it('CALCULATOR: Home → Paycheck Calculator → {Calculator}', () => {
    const trail = resolveBreadcrumbTrail({
      pageType: 'CALCULATOR',
      path: '/hourly-paycheck-calculator/',
      label: 'Hourly Paycheck Calculator',
    });
    expect(trail).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Paycheck Calculator', path: '/paycheck-calculator/' },
      { label: 'Hourly Paycheck Calculator', path: '/hourly-paycheck-calculator/' },
    ]);
  });

  it('STATE: Home → Paycheck Calculator → {State}', () => {
    const trail = resolveBreadcrumbTrail({
      pageType: 'STATE',
      path: '/paycheck-calculator/california/',
      label: 'California',
    });
    expect(trail).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Paycheck Calculator', path: '/paycheck-calculator/' },
      { label: 'California', path: '/paycheck-calculator/california/' },
    ]);
  });

  it('SALARY: Home → Salary → ${Amount} After Taxes', () => {
    const trail = resolveBreadcrumbTrail({
      pageType: 'SALARY',
      path: '/salary/50000-after-taxes/',
      amountLabel: '$50,000',
    });
    expect(trail).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Salary', path: '/salary/' },
      { label: '$50,000 After Taxes', path: '/salary/50000-after-taxes/' },
    ]);
  });

  it('GUIDE: Home → Guides → {Guide}', () => {
    const trail = resolveBreadcrumbTrail({
      pageType: 'GUIDE',
      path: '/guides/how-w4-works/',
      label: 'How the W-4 Works',
    });
    expect(trail).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Guides', path: '/guides/' },
      { label: 'How the W-4 Works', path: '/guides/how-w4-works/' },
    ]);
  });

  it('HUB: Home → {Hub}', () => {
    const trail = resolveBreadcrumbTrail({ pageType: 'HUB', path: '/guides/', label: 'Guides' });
    expect(trail).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Guides', path: '/guides/' },
    ]);
  });

  it('is deterministic — identical input always produces identical output', () => {
    const input = {
      pageType: 'STATE' as const,
      path: '/paycheck-calculator/texas/',
      label: 'Texas',
    };
    expect(resolveBreadcrumbTrail(input)).toEqual(resolveBreadcrumbTrail(input));
  });
});
