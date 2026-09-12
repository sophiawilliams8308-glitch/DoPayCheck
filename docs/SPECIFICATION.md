DO PAYCHECK — MASTER SPECIFICATION

PROJECT:
DoPayCheck
Domain: https://dopaycheck.com/

==================================================
MISSION
==================================================

DoPayCheck is a production-grade US Paycheck & Payroll Tax Transparency Platform.

Core promise:

"Know What You'll Take Home."

The platform should help users understand:

- How much they will take home
- How much federal tax is withheld
- How much Social Security and Medicare are withheld
- How much state and local tax is withheld
- How pre-tax and post-tax deductions affect take-home pay
- Why their paycheck has the final amount
- How employer payroll costs work
- How tax rules change by tax year and jurisdiction

The product must be:

- Accurate
- Transparent
- Production-grade
- Scalable
- Secure
- Mobile-first
- SEO-friendly
- Fast
- Accessible
- Easy to maintain
- Easy to update annually
- Auditable
- Source-traceable

==================================================
DOPAYCHECK MASTER SPECIFICATION
==================================================


# 1. PRODUCT OVERVIEW

DoPayCheck is a US paycheck/payroll calculator and tax transparency platform.

Primary user promise:

"Know What You'll Take Home."

The platform should calculate and explain estimated employee take-home pay based on:

- Salary
- Hourly pay
- Regular hours
- Overtime
- Bonus
- Commission
- Tips
- Other compensation
- Pay frequency
- Federal W-4 information
- Filing status
- Dependents where applicable
- Additional withholding
- Pre-tax deductions
- Post-tax deductions
- State
- Work location
- Residence location
- County
- City
- Locality
- YTD wages and withholding where applicable

The platform should support both employee-facing and future employer-facing payroll calculations.

Accuracy and transparency are more important than superficial feature quantity.

==================================================
# 2. CORE ARCHITECTURE PRINCIPLES
==================================================

Tax rules must be DATA-DRIVEN.

Tax rates, brackets, wage bases, thresholds, allowances, contribution limits, effective dates and jurisdiction-specific values must NOT be scattered throughout application code.

Rules must be:

- Versioned
- Effective-dated
- Source-traceable
- Reviewable
- Testable
- Auditable
- Publish-controlled
- Historically preserved

Never destructively overwrite historical tax rules.

A new tax year should primarily be handled by adding/updating rule DATA rather than rewriting application code.

Generic calculation methodologies may exist in code.

Tax/business/jurisdiction values must not be hardcoded into UI components or random calculation files.

Missing or uncertain information must NEVER be invented.

Use statuses such as:

- PENDING
- CONFLICT
- NOT_STATED
- PARTIALLY_VERIFIED
- NOT_APPLICABLE

when appropriate.

Official government sources are the source of truth for tax data.

AI may assist with extraction/research in a future workflow, but AI must never automatically publish tax rules without verification and approval.

==================================================
# 3. APPLICATION ARCHITECTURE
==================================================

DoPayCheck must be ONE integrated full-stack application.

DO NOT create:

/frontend
/backend

as two separate top-level applications.

If Next.js is selected, use a single Next.js App Router application.

Conceptual structure may include:

/app
/components
/lib
/prisma
/data
/public
/tests
/docs

Potential logical modules:

/lib/calculator
/lib/tax
/lib/payroll
/lib/rules
/lib/jurisdictions
/lib/validation
/lib/sources
/lib/updates
/lib/audit
/lib/reports
/lib/monetization
/lib/seo
/lib/security
/lib/cache
/lib/utils

Calculation engine should remain as independent and testable as practical.

Database access, external services and UI concerns should not contaminate core calculation methodology.

==================================================
# 4. CALCULATION ENGINE
==================================================

Primary calculation function:

calculatePaycheck(input)

Recommended pipeline:

1. validateInput
2. normalizeInput
3. resolveJurisdiction
4. resolveApplicableRules
5. calculateGrossPay
6. calculatePreTaxDeductions
7. determineTaxability
8. calculateFederalIncomeTax
9. calculateSocialSecurity
10. calculateMedicare
11. calculateAdditionalMedicare
12. calculateStateTaxes
13. calculateLocalTaxes
14. calculatePostTaxDeductions
15. calculateEmployerTaxes
16. validateCalculation
17. attachRuleVersions
18. attachOfficialSources
19. createCalculationSnapshot

Money calculations must use Decimal / NUMERIC-safe financial arithmetic.

Do NOT use JavaScript floating point arithmetic for authoritative financial calculations.

==================================================
# 5. TAXABILITY BUCKETS
==================================================

The engine must support independent taxability buckets such as:

- federalIncomeTaxWages
- socialSecurityWages
- medicareWages
- stateIncomeTaxWages
- localIncomeTaxWages
- futaWages
- sutaWages

Different deductions and compensation types may affect different taxability buckets.

The system must not assume that one taxable-wage value applies to every tax.

==================================================
# 6. FEDERAL TAX SYSTEM
==================================================

Federal tax architecture must support:

- Federal income tax
- Federal withholding
- Social Security
- Medicare
- Additional Medicare
- FUTA employer tax
- W-4 methodology
- Filing statuses
- Pay frequencies
- Additional withholding
- Multiple-job scenarios where applicable
- Dependents/credit-related inputs where applicable
- Wage bases
- Thresholds
- Effective dates

Important:

Annual federal income-tax brackets must NOT automatically be used as paycheck withholding tables.

Federal paycheck withholding must support the actual applicable IRS withholding methodology and tables.

For 2026, official IRS sources must be used for authoritative values.

Known official federal 2026 reference values already verified for project planning:

Standard deductions:

Single/MFS: $16,100
Head of Household: $24,150
Married Filing Jointly: $32,200

Federal marginal rates:

10%
12%
22%
24%
32%
35%
37%

Personal exemption remains $0.

2026 federal marginal bracket thresholds must be stored as rule data, not hardcoded in UI.

2026 Social Security:

Employee rate: 6.2%
Employer rate: 6.2%
Wage base: $184,500

Medicare:

Employee rate: 1.45%
Employer rate: 1.45%
No wage cap

Additional Medicare:

Employee rate: 0.9%
Threshold: $200,000

FUTA:

Employer-side only.

Standard FUTA rate: 6.0% on first $7,000 of FUTA wages.

Potential credit up to 5.4% for qualifying employers.

Potential effective rate: 0.6% for qualifying employers.

These values must be treated as sourced rule data and must carry official-source metadata.

Official federal source references include:

IRS Publication 15-T
IRS Publication 15
IRS Publication 15-A
IRS Publication 15-B

Do not assume that the above planning values are sufficient for the entire federal withholding implementation.

==================================================
# 7. STATE TAX ENGINE
==================================================

Build a reusable 50-state architecture.

State income tax methods must support:

- NONE
- FLAT
- PROGRESSIVE
- TABLE
- FORMULA
- HYBRID

Support state-specific:

- Income tax
- Withholding
- Filing status
- Withholding allowances
- Brackets
- Rates
- Thresholds
- Standard deductions where applicable
- State-specific deductions/adjustments
- Disability programs
- Paid family/medical leave
- Local taxes
- Reciprocity
- Minimum wage
- Overtime
- Special wage rules
- Effective dates

State rules must be data-driven.

Do not assume all states follow federal methodology.

==================================================
# 8. STATE WITHHOLDING
==================================================

State withholding must support:

- Pay frequency
- Filing status
- Withholding tables
- Wage ranges
- Rates
- Thresholds
- Allowances
- Adjustments
- Percentage methods
- Formula methods
- Effective dates
- Special rules

Do not replace official withholding tables with simplified annual tax brackets unless the official methodology explicitly allows it.

==================================================
# 9. LOCAL TAX ENGINE
==================================================

Local taxation must be a separate engine/module.

Support:

- City taxes
- County taxes
- Local income taxes
- Occupational taxes
- School district taxes
- Payroll taxes
- Other applicable local employee taxes

Locality resolution may consider:

- State
- County
- City
- ZIP
- Work location
- Residence location
- Local jurisdiction

Important:

ZIP code must NOT automatically be treated as the legal tax jurisdiction.

The system must support exceptions and jurisdiction-specific rules.

==================================================
# 10. RECIPROCITY
==================================================

Reciprocity must support:

- From state
- To state
- Effective from
- Effective to
- Conditions
- Withholding treatment
- Source IDs
- Special requirements

Do not assume reciprocity based only on state names.

==================================================
# 11. PAY FREQUENCIES
==================================================

Support:

- Weekly
- Biweekly
- Semimonthly
- Monthly
- Quarterly
- Annual
- Daily

The system must correctly distinguish frequency-based withholding calculations from annualized tax calculations.

==================================================
# 12. PAY TYPES
==================================================

Support:

- Regular salary
- Hourly wages
- Regular hours
- Overtime
- Bonus
- Commission
- Tips
- Other compensation

The architecture should allow additional compensation types later.

==================================================
# 13. DEDUCTIONS
==================================================

Support pre-tax and post-tax deductions.

Pre-tax examples:

- 401(k)
- Health insurance
- HSA
- FSA
- Other qualified deductions

Post-tax examples:

- Roth contributions
- Other post-tax deductions

Taxability must be determined independently for applicable tax categories.

Do not assume every deduction reduces every tax.

==================================================
# 14. W-4
==================================================

The calculator should support relevant W-4 information.

Potential inputs:

- Filing status
- Multiple jobs
- Dependents
- Other income where applicable
- Deductions where applicable
- Additional withholding

The W-4 model must be designed so future IRS changes can be represented through versioned rule/data updates.

==================================================
# 15. YTD SUPPORT
==================================================

Advanced calculation mode should support:

- YTD wages
- YTD Social Security wages
- YTD Medicare wages
- YTD federal withholding
- YTD state withholding
- YTD local withholding where applicable

This is important for wage-base limits and year-to-date calculations.

==================================================
# 16. CALCULATION STATUS
==================================================

Calculation results should support statuses:

COMPLETE
INCOMPLETE
INVALID_INPUT
RULE_CONFLICT
UNSUPPORTED_SCENARIO
CALCULATION_ERROR

The frontend must clearly distinguish an estimated result from an incomplete or unsupported calculation.

Never present a guessed tax result as authoritative.

==================================================
# 17. CALCULATION TRACE
==================================================

The platform must support transparent calculation trace.

Basic trace:

Gross Pay
→ Pre-Tax Deductions
→ Taxable Wages
→ Federal Tax
→ Social Security
→ Medicare
→ State Tax
→ Local Tax
→ Post-Tax Deductions
→ Net Pay

Advanced/admin trace should expose more detailed calculation steps.

"Why Is My Paycheck This Amount?" must use ACTUAL calculation data from the calculation engine.

Do not create generic explanations that contradict the actual calculation.

==================================================
# 18. RULE STATUS SYSTEM
==================================================

Tax rules must support:

DRAFT
PENDING_REVIEW
APPROVED
ACTIVE
SUPERSEDED
REJECTED
ROLLED_BACK
BLOCKED

A rule should not become ACTIVE without required verification and approval.

==================================================
# 19. RULE COMPONENT VERIFICATION
==================================================

Each rule component may have:

VERIFIED
NOT_APPLICABLE
PENDING
CONFLICT
PARTIALLY_VERIFIED
NOT_STATED

Important distinction:

NOT_APPLICABLE means the rule does not apply.

NOT_STATED means the official source does not state the value.

Never convert NOT_STATED into zero.

Never invent a zero value.

==================================================
# 20. RULE MANAGEMENT WIZARD
==================================================

Admin:

Tax Rules → Add New Rule

Basic fields:

- Tax Year
- Jurisdiction Type
- Jurisdiction
- Rule Category
- Effective From
- Effective To
- Official Source
- Status

Dynamic fields by category.

Categories:

1. Federal Income Tax
2. Federal Withholding
3. Social Security
4. Medicare
5. State Income Tax
6. State Withholding
7. Disability / SDI
8. Paid Leave
9. SUTA
10. Minimum Wage
11. Overtime
12. Reciprocity
13. Local Taxes

Federal Income Tax fields should support:

- Structure
- Filing statuses
- Standard deduction
- Personal exemption
- Brackets
- Lower threshold
- Upper threshold
- Rate
- Base/additional tax where explicitly stated

Federal Withholding must preserve full official withholding tables.

Social Security:

- Employee rate
- Employer rate
- Wage base
- Effective dates

Medicare:

- Employee rate
- Employer rate
- Wage limit/no limit
- Additional Medicare rate
- Additional Medicare threshold

State Income Tax:

- Structure
- Filing statuses
- Brackets
- Flat rate
- Effective dates

State Withholding:

- Method
- Filing status
- Pay frequency
- Tables
- Thresholds
- Rates
- Allowances
- Adjustments

Disability:

- Program
- Employee contribution
- Employer contribution
- Wage base
- Maximum employee contribution
- Effective dates

Paid Leave:

- Program
- Employee rate
- Employer rate
- Wage base
- Maximum contribution
- Effective dates

SUTA:

- Employee applicability
- Employee rate
- Employer rate
- New employer rate
- Experience rate minimum
- Experience rate maximum
- Taxable wage base

Minimum Wage:

- Standard minimum wage
- Tipped wage
- Youth/training/special wage
- Local overrides
- Effective dates

Overtime:

- Threshold
- Multiplier
- Daily/weekly method
- Double-time where applicable
- Exceptions

Reciprocity:

- From state
- To state
- Effective dates
- Withholding treatment
- Conditions
- Source

Local Taxes:

- State
- County
- City
- Locality
- Tax type
- Employee rate
- Employer rate
- Wage base
- Threshold
- Effective dates
- Conditions
- Exceptions

==================================================
# 21. SOURCE TRACEABILITY
==================================================

Every important tax rule must have source metadata.

Support:

- Official agency
- Source document
- Source URL
- Page
- Section
- Table
- Heading
- Published date
- Effective date
- Verification status
- Notes

The system should make it possible to determine:

Which rule was used?
Which version was used?
Which source supports it?
When was it effective?
Who approved it?

==================================================
# 22. RULE PUBLISH GATE
==================================================

Publishing flow:

Save Draft
→ Validate
→ Source Check
→ Conflict Check
→ Tests
→ Submit for Review
→ Approve
→ Publish

Publishing must be disabled when:

- Required fields are missing
- Source is missing
- Effective dates are invalid
- Conflicts exist
- Required tests fail
- Approval is missing

==================================================
# 23. ANNUAL TAX YEAR WORKFLOW
==================================================

Annual updates must be simple for administrators.

Example:

Admin
→ Tax Year
→ Rule Category
→ Add/Edit Rule
→ Enter official values
→ Add official source
→ Validate
→ Review
→ Approve
→ Publish

Frontend automatically uses the active applicable rules.

Routine annual tax updates should NOT require frontend code changes.

Historical rules must remain available.

A 2027 rule must not overwrite 2026.

Support:

- Draft
- Validation
- Review
- Approval
- Publish
- Supersede
- Rollback

==================================================
# 24. MANUAL PDF EXTRACTION WORKFLOW
==================================================

Initial implementation must NOT automatically integrate AI into the backend for PDF extraction.

Preferred workflow:

1. Download official government PDF.
2. Upload official PDF to ChatGPT.
3. Use strict extraction prompt.
4. Extract structured rule data.
5. Copy/enter extracted values into DoPayCheck admin.
6. Backend validates data.
7. Human reviews.
8. Human approves.
9. Publish.
10. Frontend automatically uses active rule.

Official PDF is the source of truth.

AI is an extraction assistant only.

If PDF is scanned:

- OCR may be used.
- OCR output remains untrusted.
- Human verification is required.

If the PDF does not state a value:

- Do not guess.
- Do not infer.
- Mark NOT_STATED or PENDING.

If conflicting information exists:

- Mark CONFLICT.
- Do not silently choose one.

If effective dates change mid-year:

- Create separate effective-dated versions.

==================================================
# 25. ADMIN DASHBOARD
==================================================

Admin should feel familiar, simple and WordPress-like.

Persistent left sidebar.

Main sections:

Dashboard
Calculator
Tax Rules
Payroll Rules
Jurisdictions
Tax Years
Sources
Updates
Verification
Calculations
Reports
Monetization
Audit Logs
Blog
SEO
Settings
Users
System Health

Use:

- Searchable tables
- Filters
- Pagination
- Clear forms
- Save buttons
- Publish buttons
- Draft status
- Review status
- Familiar CRUD patterns
- Clear warnings
- Confirmation dialogs

Avoid unnecessary technical terminology.

==================================================
# 26. SETTINGS
==================================================

Settings sections:

General
Calculator
Tax Rules
Tax Years
Jurisdictions
Pay Frequencies
W-4
Deductions
Permalinks
SEO
Appearance
Reports
Performance
Privacy
Security
Notifications
API
Integrations
Feature Flags
Import/Export
Backup & Recovery
Maintenance
Accessibility
Advanced
System Info

Do NOT move major operational modules into Settings.

Tax Rules, Sources, Updates, Verification, Calculations, Reports and Audit Logs remain dedicated top-level sections.

==================================================
# 27. SYSTEM HEALTH
==================================================

System Health should work similar to WordPress Site Health.

Check:

- Database
- Rule engine
- Tax years
- Sources
- Cache
- Cron/jobs
- API
- Storage
- Reports
- Failed calculations
- Configuration
- Security
- Deployment readiness

==================================================
# 28. EMERGENCY CONTROLS
==================================================

Admin should eventually support:

- Maintenance mode
- Disable calculator
- Disable specific state
- Disable specific rule category
- Rollback latest rule
- Clear cache
- Pause reports
- Pause monetization
- Pause lead generation

All sensitive actions must be permission-controlled and audited.

==================================================
# 29. CRUD / DELETE / ARCHIVE POLICY
==================================================

Where applicable:

Create
View
Edit
Duplicate
Archive
Restore
Delete
Search
Filter
Bulk actions

Published tax rules:

DO NOT destructively delete.

Use:

- Archive
- Supersede
- Rollback

Draft/unused data may be deleted with confirmation.

Used sources:

Archive rather than destructive deletion.

Published blog:

Trash/archive.

Permanent deletion only where safe.

Jurisdictions/tax years referenced by calculations:

Archive/deactivate rather than destructive deletion.

Audit logs:

NEVER delete.

Destructive confirmation message:

"This action cannot be undone."

Reset must be separate from Delete.

==================================================
# 30. DUPLICATE / CLONE RULE
==================================================

Published rule may be duplicated into a new draft.

Example:

2026 California rule
→ Duplicate
→ 2027 California Draft

Never automatically activate a duplicated rule.

==================================================
# 31. AUDIT LOG
==================================================

Audit actions:

CREATE
EDIT
DUPLICATE
APPROVE
REJECT
PUBLISH
ROLLBACK
ARCHIVE
RESTORE
DELETE
RESET
IMPORT
EXPORT

Audit record should contain:

- Actor
- Timestamp
- Entity
- Entity ID
- Action
- Old value
- New value
- Reason
- Metadata

Audit logs must be immutable.

==================================================
# 32. HOMEPAGE
==================================================

Homepage structure:

Header

Hero:
"Know What You'll Take Home"

Primary Paycheck Calculator

Trust Strip

Paycheck Breakdown Preview

What We Calculate

All 50 States

Popular Calculators

How It Works

Why DoPayCheck

Latest Guides & Insights

FAQ

Final CTA

Footer

State links must be actual:

<a href="...">

links.

Do not use JS-only buttons for important navigation.

==================================================
# 33. MAIN CALCULATOR
==================================================

Calculator should use progressive disclosure.

Step 1 — Pay

- Salary/hourly
- Annual salary
- Hourly rate
- Regular hours
- Overtime
- Bonus
- Commission
- Tips
- Other compensation
- Pay frequency

Step 2 — Location

- State
- Work state
- Residence state
- County
- City
- Locality where applicable

Step 3 — Tax / W-4

- Filing status
- W-4 inputs
- Multiple jobs where applicable
- Dependents where applicable
- Additional withholding

Step 4 — Deductions

- Pre-tax deductions
- 401(k)
- Health insurance
- HSA
- FSA
- Other pre-tax
- Post-tax
- Roth
- Other post-tax

Step 5 — Advanced / YTD

- YTD wages
- YTD Social Security wages
- YTD Medicare wages
- YTD withholding
- Bonus
- Overtime
- Tips
- Other advanced inputs

Show only relevant fields.

==================================================
# 34. CALCULATOR RESULTS
==================================================

Estimated Take-Home Pay must be prominent.

Show:

- Gross pay
- Federal income tax
- Social Security
- Medicare
- Additional Medicare
- State tax
- Local tax
- Pre-tax deductions
- Post-tax deductions
- Net pay
- Annual estimate
- Monthly estimate where valid
- Effective tax rate where meaningful

Also provide:

"Why Is My Paycheck This Amount?"

Use real calculation trace.

==================================================
# 35. STATE PAGES
==================================================

URL:

/paycheck-calculator/{state}/

Examples:

/paycheck-calculator/california/
/paycheck-calculator/texas/
/paycheck-calculator/pennsylvania/

State pages must be genuinely state-specific.

Do NOT create thin doorway pages.

Each page should contain:

- State-specific hero
- Calculator above the fold
- State tax breakdown
- Gross pay
- Federal
- FICA
- State
- Local where applicable
- Deductions
- Take-home
- Why Is My Paycheck This Amount?
- State-specific inputs
- Pay frequency
- Advanced options
- State overview
- How calculation works
- Salary examples
- Minimum wage
- Overtime
- Official sources
- Methodology
- Related calculators
- Other states
- Guides
- FAQ

Examples:

California should support relevant:

- State income tax
- State withholding
- SDI
- Paid leave
- Local considerations

Texas should correctly represent:

- No individual state income tax
- Federal taxes
- FICA
- Applicable deductions

Pennsylvania should support relevant:

- State tax
- Local tax complexity
- Local jurisdiction considerations

Do not hardcode these facts into templates. Represent them through verified rule data.

==================================================
# 36. URL ARCHITECTURE
==================================================

Primary:

/paycheck-calculator/

State:

/paycheck-calculator/{state}/

Generic calculators:

/salary-paycheck-calculator/
/hourly-paycheck-calculator/
/overtime-calculator/
/bonus-tax-calculator/
/take-home-pay-calculator/

Guides:

/guides/

Optional future:

/updates/

Do not automatically create indexable pages for every pay frequency without keyword research.

Avoid duplicate routes such as:

/california-paycheck-calculator/
/calculator/california/
/state/california/

Only one canonical state route.

Do not create indexable query parameter duplicates when a dedicated state page exists.

==================================================
# 37. SEO
==================================================

Implement architecture for:

- Canonical URLs
- Metadata
- Title
- Meta description
- Open Graph
- Twitter/social metadata where appropriate
- XML sitemap
- Robots.txt
- Structured data
- Breadcrumbs
- Internal linking
- 404
- Redirects
- HTTPS
- Preferred hostname
- Lowercase URLs
- Hyphenated slugs
- Consistent trailing slash policy

Sitemap should include only:

- Canonical
- Indexable
- Valid
- HTTP 200

URLs.

Tax year should NOT normally be included in calculator URLs.

==================================================
# 38. BLOG / GUIDES
==================================================

Admin label:

Blog

Frontend label:

Guides & Insights

Fields:

- Title
- Slug
- Featured image
- Content editor
- Category
- Tags
- Author
- SEO title
- Meta description
- Canonical
- Schema
- Publish/draft/schedule
- Revision history

Content focus:

- US paycheck
- Payroll
- Taxes
- Salary
- W-4
- Employee pay
- Take-home pay
- State taxes
- Payroll education

Guides should link to relevant calculators.

Calculators should link to relevant guides.

==================================================
# 39. REPORTS / PDF
==================================================

Reports are an independent module.

Flow:

Calculator
→ Calculation Engine
→ Final Result
→ Calculation Snapshot
→ Report Builder
→ Report Template
→ PDF Generator
→ Secure Storage
→ Download / Email

PDF must NEVER calculate taxes independently.

PDF uses the calculation snapshot.

Supported report types:

BASIC_PAYCHECK
PROFESSIONAL_PAYCHECK
ANNUAL_SUMMARY
COMPARISON
WHAT_IF
EMPLOYER_COST
EMPLOYEE_COST
MULTI_EMPLOYEE

Professional report should contain:

- Logo
- Header
- Report title
- Report ID
- Generated date
- Tax year
- State
- Jurisdiction
- Pay frequency
- Pay inputs
- Taxable wage buckets
- Employee taxes
- Deductions
- Gross
- Total taxes
- Total deductions
- Net pay
- Effective rate
- Employer costs where applicable
- Why amount
- Methodology
- Calculation trace
- Rule versions
- Effective dates
- Official sources

==================================================
# 40. CALCULATION SNAPSHOT
==================================================

Each report-worthy calculation should support an immutable snapshot containing:

- Original input
- Normalized input
- Result
- Tax year
- Jurisdiction
- Rule IDs
- Rule versions
- Official sources
- Timestamp
- Calculation engine version

Historical report must remain reproducible even after future tax-rule changes.

==================================================
# 41. REPORT STATUS
==================================================

Reports support:

GENERATING
READY
FAILED
EXPIRED
DELETED

Failed reports should support retry.

Do not generate a final report from:

- Incomplete calculation
- Rule conflict
- Invalid calculation

==================================================
# 42. REPORT SECURITY
==================================================

Reports may contain sensitive salary/tax information.

Use:

- Secure report IDs
- Authentication where required
- Signed/expiring URLs
- Secure storage
- Retention/expiration policy
- Access controls

Do not use predictable public PDF URLs.

Report wording should say:

"Estimated Paycheck Calculation Report"

or

"Professional Paycheck Estimate Report"

Do NOT call it an official employer-issued pay stub unless the actual product supports that legally and technically.

==================================================
# 43. REPORT SETTINGS
==================================================

Settings → Reports

Support:

- Enable/disable
- Default report type
- Default template
- PDF settings
- Branding
- Content sections
- Storage
- Retention
- Email
- Premium entitlements

==================================================
# 44. MONETIZATION
==================================================

Monetization must be completely separate from calculation logic.

Potential future revenue channels:

- AdSense/display advertising
- Affiliate marketing
- Payroll referrals
- Accounting referrals
- HR referrals
- Benefits referrals
- Qualified lead generation
- Sponsored content
- Premium reports
- Premium calculator tools
- Employer tools
- API
- SaaS
- Tax data/API licensing
- Newsletter sponsorship
- Digital products

Monetization MUST NEVER influence tax calculations.

==================================================
# 45. ADSENSE
==================================================

Centralized ad slot component.

Potential future slots:

- Header
- Calculator before
- Calculator after
- Result
- Content
- Sidebar
- Footer
- Mobile

Admin:

Monetization → Ads

Settings:

- Enable/disable
- Publisher ID
- Ad slot IDs
- Auto Ads
- Placement ON/OFF
- Device controls
- Test/production
- Preview

Ads must not:

- Look like Calculate buttons
- Look like Download buttons
- Look like tax results
- Mislead users
- Excessively interrupt calculator UX
- Hurt performance
- Violate ad policies

==================================================
# 46. LEAD GENERATION
==================================================

Future funnel:

SEO
→ Calculator
→ User intent
→ Relevant CTA
→ Lead form
→ Qualification
→ Lead scoring
→ Partner matching
→ Delivery
→ Conversion tracking

Potential categories:

- Payroll
- Accounting
- HR
- Benefits
- Time tracking

Lead model should support:

- Business name
- Employee count
- State
- Needs
- Current payroll solution
- Email
- Source
- Type
- Status
- Qualification answers
- Score
- Partner
- Category
- Routing rules
- Delivery status
- Consent
- Disclosure
- Conversion
- Revenue attribution

Commercial scoring must be configurable.

Do not scatter scoring logic as hardcoded values.

Do not aggressively interrupt basic employee calculator users.

Employer/payroll-cost tools are better high-intent lead opportunities.

Potential commercial models:

- CPL
- CPA
- Revenue share

Architecture only initially.

==================================================
# 47. AFFILIATE SYSTEM
==================================================

Affiliate architecture should support:

- Partner
- URL
- Category
- Disclosure
- Placement
- Active dates
- Active status
- Click tracking
- Conversion tracking
- Revenue attribution

Affiliate activity must not affect calculation results.

==================================================
# 48. EMPLOYER TOOLS
==================================================

Future tools:

- Employer Payroll Cost Calculator
- Employee Cost Calculator
- Hiring Cost Calculator
- Overtime Cost Calculator
- SUTA/FUTA Cost Calculator
- Multi-employee payroll estimator
- Payroll budget calculator

All employer tools should share the same:

- Calculation engine
- Rule engine
- Jurisdiction engine
- Versioning
- Source system

==================================================
# 49. WHAT-IF / SCENARIO TOOLS
==================================================

Future support for:

- Salary comparison
- Hourly comparison
- State comparison
- Pay-frequency comparison
- Bonus scenarios
- Overtime scenarios
- 401(k) scenarios
- Deduction scenarios
- Employer-cost scenarios

Multiple scenarios should be calculated through the same authoritative engine.

==================================================
# 50. API / SAAS
==================================================

Future API input:

- Salary
- State
- Filing status
- Pay frequency
- W-4
- Deductions
- YTD information

Output:

- Gross
- Federal
- FICA
- State
- Local
- Net
- Rule versions
- Official sources

Future API architecture should support:

- API keys
- Plans
- Rate limits
- Usage tracking
- Logs
- Authentication
- Versioning
- Security

==================================================
# 51. ADMIN APPEARANCE / BRANDING
==================================================

Admin:

Settings → Appearance / Branding

Configurable:

- Logo
- Favicon
- Primary Color
- Secondary Color
- Accent Color
- Button Color
- Button Hover Color
- Link Color
- Header Background
- Footer Background
- Text Color
- Background Color
- Card Background
- Border Color
- Success Color
- Warning Color
- Error/Danger Color
- Typography
- Border Radius
- Container Width
- Shadow Style
- Animation Level

Support:

- Color picker
- HEX
- Live preview
- Save
- Preview Before Publish
- Reset This Setting
- Reset All Appearance Settings

Reset must require confirmation.

Use centralized design tokens.

Do not scatter HEX values throughout components.

==================================================
# 52. DEFAULT BRAND
==================================================

Default colors:

Primary Deep Blue:
#2563EB

Primary Hover:
#1D4ED8

Secondary Navy:
#0F172A

Accent Teal:
#14B8A6

Background:
#F8FAFC

Card:
#FFFFFF

Main Text:
#0F172A

Secondary Text:
#64748B

Border:
#E2E8F0

Success:
#16A34A

Warning:
#D97706

Error:
#DC2626

All should be configurable through the design system.

==================================================
# 53. TYPOGRAPHY
==================================================

Primary font:

Inter

Use Inter for:

- Headings
- Body
- Buttons
- Forms
- Tables
- Results
- Admin
- Financial values

Financial numbers must be highly readable.

Avoid decorative fonts.

Load only required weights.

Optimize font loading.

Future font replacement should be possible centrally.

==================================================
# 54. INTERACTIONS / HOVER
==================================================

Buttons:

- Slight color transition
- Slight lift
- Subtle shadow

Cards:

- Slight elevation
- Border transition

Links:

- Color transition
- Underline transition where appropriate

Icons/arrows:

- Small movement where useful

==================================================
# 55. ANIMATION
==================================================

Possible animations:

- Hero entrance
- Calculator step transitions
- Result reveal
- Subtle number animation
- Chart reveal
- Modal transitions
- Toast transitions

Avoid:

- Flashing
- Bouncing
- Heavy particles
- Heavy parallax
- Long animations
- Unnecessary motion

Performance must be more important than animation.

Respect:

prefers-reduced-motion

==================================================
# 56. UI STYLE
==================================================

Visual direction:

Premium US fintech/payroll SaaS.

Characteristics:

- Trustworthy
- Clean
- Modern
- Professional
- Mobile-first
- Polished
- Simple
- Data-focused

Avoid gimmicky design.

==================================================
# 57. SECURITY
==================================================

Support:

- Authentication
- Role-based access control
- Input validation
- Zod or equivalent validation
- Rate limiting
- Secure cookies
- Secure headers
- XSS protection
- SQL injection protection
- Environment secrets
- Audit logs
- Secure file handling
- Secure PDF handling
- Protected admin routes

Never commit real secrets.

==================================================
# 58. PRIVACY
==================================================

Potentially sensitive user information includes:

- Salary
- Tax information
- W-4 information
- Deductions
- Location
- Email

Follow data minimization.

Support appropriate:

- Retention
- Deletion
- Export
- Consent
- Lead disclosure
- Privacy controls

==================================================
# 59. ACCESSIBILITY
==================================================

Build accessibility from the beginning.

Support:

- Keyboard navigation
- Visible focus
- Semantic HTML
- Proper labels
- Accessible form errors
- Screen readers
- Accessible tables
- Good contrast
- Reduced motion

Accessibility should be considered during component creation, not retrofitted later.

==================================================
# 60. PERFORMANCE
==================================================

Core Web Vitals are non-negotiable:

- LCP
- INP
- CLS

Architecture should support:

- Server rendering where appropriate
- Minimal JavaScript
- Minimal hydration
- Code splitting
- Lazy loading
- Optimized images
- Optimized fonts
- Efficient database queries
- Caching
- Minimal third-party scripts

Do not sacrifice performance for unnecessary animations or scripts.

==================================================
# 61. TESTING
==================================================

Testing must include:

- Unit tests
- Integration tests
- Regression tests
- Golden tests
- E2E tests

Test:

- Rule resolution
- Tax year selection
- Effective dates
- Jurisdiction
- Decimal handling
- Rule statuses
- Source handling
- Publish gates
- Permissions
- CRUD
- Archive
- Restore
- Appearance
- Reset
- Canonical URLs
- Calculation snapshots
- Reports
- Security
- Error handling

Tax calculations should have table-driven tests against known verified cases.

Never use fake production tax values as authoritative tests.

==================================================
# 62. DEPLOYMENT
==================================================

Target domain:

https://dopaycheck.com/

Hostinger deployment must be practical and documented.

Do NOT blindly assume public_html is sufficient.

Determine actual Hostinger plan/runtime before final deployment instructions.

If Node.js is required:

Document correct Hostinger Node deployment.

Do NOT use static export if it breaks:

- API
- Server calculation
- Admin
- Database
- Authentication
- PDF generation
- Jobs
- Security
- Future functionality

Production package should eventually include:

/deploy/

or equivalent.

Also:

.env.example

/docs/DEPLOYMENT.md

/DEPLOYMENT-README.md

Deployment documentation must cover:

- Upload location
- Runtime
- Environment variables
- Database
- Migration
- Domain
- SSL
- Startup
- Restart
- Permissions
- Cron/jobs
- Storage
- Cache
- Verification
- Backup
- Rollback
- Troubleshooting

Production readiness requires:

- Build passes
- Typecheck passes
- Tests pass
- Security checks pass
- Configuration verified
- Deployment verified
- No localhost references
- No dev credentials
- No debug mode
- No fake production tax data
- No unresolved critical errors

Tax data updates should not require a full redeploy.

Methodology/code changes may require deployment.

==================================================
# 63. BACKUP & RECOVERY
==================================================

Support backups for:

- Database
- Rule data
- Configuration
- Full exports
- Recovery checkpoints

Before major tax-rule publication, create a recoverable checkpoint where practical.

Rollback must be:

- Non-destructive
- Auditable

==================================================
# 64. FEATURE FLAGS
==================================================

Support configurable feature flags for:

- Local tax
- Employer costs
- Calculation trace
- Reports
- Comparison
- Affiliate
- Lead generation
- API
- New calculators
- Experimental features

==================================================
# 65. CALCULATOR DEFAULTS
==================================================

Admin should eventually configure:

- Default tax year
- Default pay frequency
- Default state
- Show annual estimate
- Show effective rate
- Show employer costs
- Show calculation trace
- Show sources

==================================================
# 66. HOMEPAGE STATE LINKS
==================================================

All 50 states should eventually have direct internal links.

Example:

/paycheck-calculator/california/
/paycheck-calculator/texas/
/paycheck-calculator/new-york/

Use actual anchor links.

Sitemap must contain canonical state pages.

==================================================
# 67. SEO CONTENT STRATEGY
==================================================

Build topical authority around:

- Paycheck calculators
- Salary
- Hourly pay
- Take-home pay
- Federal withholding
- W-4
- State payroll taxes
- Local payroll taxes
- Overtime
- Bonuses
- Deductions
- Payroll education

Connect:

Guides ↔ Calculators

through contextual internal links.

==================================================
# 68. DEVELOPMENT ROADMAP
==================================================

Development must happen phase-by-phase.

Do not implement multiple phases at once.

12 phases:

PHASE 1:
Foundation

- Repository audit
- Architecture
- Database foundation
- Environment
- Folder structure
- Core project setup

PHASE 2:
Rule & Data System

- Federal/state/local rule schema
- Database relationships
- Tax-year versioning
- Effective dates
- Source traceability

PHASE 3:
Calculation Engine

- Gross pay
- Deductions
- Taxability
- Decimal arithmetic
- Calculation trace
- Snapshot

PHASE 4:
Federal Engine

- Federal income tax
- Federal withholding
- Social Security
- Medicare
- Additional Medicare
- FUTA

PHASE 5:
50-State Engine

- State income tax
- State withholding
- SUTA
- Disability
- Paid leave
- Minimum wage
- Overtime

PHASE 6:
Local Tax Engine

- City
- County
- Locality
- Local payroll tax
- Reciprocity
- Jurisdiction resolution

PHASE 7:
Update Mechanism

- Source monitoring
- Change detection
- Draft
- Verify
- Test
- Publish
- Rollback

PHASE 8:
Admin Dashboard

- Rule management
- Source verification
- Approvals
- Audit logs
- Monitoring
- System health

PHASE 9:
Calculator Frontend

- Salary
- Hourly
- W-4
- Deductions
- Location
- Bonus
- Commission
- Tips
- Overtime
- YTD

PHASE 10:
Results & UX

- Take-home
- Breakdown
- Charts
- Why amount
- Annual/monthly
- Comparison
- Reports

PHASE 11:
SEO + Content

- State landing pages
- Calculator landing pages
- Metadata
- Schema
- Internal links
- Guides
- FAQ

PHASE 12:
QA + Production

- Regression
- E2E
- Security
- Performance
- Accessibility
- Deployment
- Monitoring
- Backup
- Rollback

==================================================
# 69. PHASE DISCIPLINE
==================================================

For EVERY phase:

1. Implement ONLY assigned phase.
2. Test.
3. Verify.
4. Report.
5. STOP.

Never automatically continue to the next phase.

Wait for explicit approval.

==================================================
# 70. CLAUDE CODE RULES
==================================================

Before development:

- Audit repository.
- Read docs/SPECIFICATION.md.
- Preserve useful existing work.
- Do not invent requirements.
- Do not invent tax data.
- Do not overwrite historical rules.
- Do not delete functionality unless obsolete and clearly explained.
- Do not create separate /frontend and /backend applications.
- Do not skip testing.
- Do not silently make major architecture decisions.
- Mark missing information as:
  PENDING DECISION
  PENDING DATA
  PENDING VERIFICATION

Every phase report should include:

- What was implemented
- Files created
- Files changed
- Files deleted, if any
- Database changes
- Architecture changes
- Tests
- Build result
- Typecheck result
- Security status
- Known issues
- Pending decisions
- Pending data
- Pending verification
- Next phase recommendation

Then STOP.

==================================================
# 71. MASTER PRINCIPLE
==================================================

DoPayCheck must prioritize:

ACCURACY
TRANSPARENCY
SOURCE TRACEABILITY
AUDITABILITY
SECURITY
MAINTAINABILITY
PERFORMANCE
SEO
ACCESSIBILITY
SCALABILITY

Never sacrifice tax accuracy for speed of implementation.

Never invent tax data.

Never hide uncertainty.

Never silently overwrite historical tax rules.

Never allow monetization logic to influence calculation logic.

Never allow AI-generated tax data to become production-authoritative without human verification and approval.

==================================================
# END OF MASTER SPECIFICATION
==================================================
