/**
 * QA driver (TEST-ONLY): with a build that has NO deployment records for the chains (the default build: no NEXT_PUBLIC_USE_FORK_DEPLOYMENTS,
 * or fork-only records), the home page shows "Not deployed" in every column, /portfolio disables opening a vault by address, and a
 * deep-linked address has no deposit / redeem / swap cards.
 *   node scripts/qa/qa-no-protocol.mjs      env: APP (default http://localhost:3100), PLAYWRIGHT_MODULE
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const B = process.env.APP || 'http://localhost:3100';
let bad = false;
const check = (name, ok, extra = '') => { if (!ok) bad = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(B + '/', { waitUntil: 'networkidle' });
for (const id of [1, 8453, 42161, 4663]) {
  for (const col of ['create', 'deposit', 'swap']) {
    const t = (await p.getByTestId(`home-${col}-${id}`).innerText()).trim();
    check(`home ${col} column, chain ${id}`, t === 'Not deployed', `(${t})`);
  }
}
await p.goto(B + '/portfolio', { waitUntil: 'networkidle' });
check('/portfolio shows paste-disabled', (await p.getByTestId('paste-disabled').count()) === 1);
check('/portfolio vault input disabled', await p.locator('input[aria-label="Vault address"]').isDisabled());
check('/portfolio Open button disabled', await p.getByRole('button', { name: /^Open$/ }).isDisabled());
for (const slug of ['ethereum', 'robinhood']) {
  await p.goto(`${B}/portfolio/${slug}/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  const cards = (await p.getByTestId('deposit-card').count()) + (await p.getByTestId('redeem-card').count()) + (await p.getByTestId('swap-card').count());
  check(`/portfolio/${slug}/<address>: no action cards`, cards === 0);
  check(`/portfolio/${slug}/<address>: "Protocol not deployed" notice`, (await p.getByText(/Protocol not deployed/).count()) > 0);
}
await b.close();
if (bad) { console.log('NO-PROTOCOL TEST FAILED'); process.exit(1); }
console.log('NO-PROTOCOL TEST OK');
