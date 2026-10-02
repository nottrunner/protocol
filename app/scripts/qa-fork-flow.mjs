/**
 * QA driver (TEST-ONLY): create -> deposit -> reload -> my portfolios -> swap (every route offered) -> redeem on one chain, against a
 * build made with NEXT_PUBLIC_E2E_MOCK_WALLET=1 NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX=1 NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1 and local Anvil
 * forks (see README "QA: run the exact SHA against local Anvil forks"). The mock-wallet account needs >= 1000 of the denomination asset.
 *
 *   node scripts/qa-fork-flow.mjs <chainId> <swapAmountInDenomination>      e.g.  node scripts/qa-fork-flow.mjs 8453 300
 *   env: APP (default http://localhost:3100), OUT_DIR (screenshots, default ./qa-out), PLAYWRIGHT_MODULE (path/specifier of playwright)
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const B = process.env.APP || 'http://localhost:3100';
const chainId = process.argv[2] || '1';
if (!['1', '8453', '42161', '4663'].includes(chainId)) throw new Error('chainId must be 1, 8453, 42161 or 4663');
const swapAmt = process.argv[3] || '500';
const OUT = (process.env.OUT_DIR || './qa-out') + '/';
await (await import('node:fs/promises')).mkdir(OUT, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message.slice(0, 300)));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
const log = (...a) => console.log(`[${chainId}]`, ...a);
const shot = n => p.screenshot({ path: `${OUT}${chainId}-${n}.png`, fullPage: true });
const txt = async (id) => (await p.getByTestId(id).first().innerText().catch(() => '<none>')).replace(/\s+/g, ' ');
await p.goto(B + '/create', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /^connect wallet$/i }).first().click();
await p.getByText('E2E Mock Wallet').first().click();
await p.waitForTimeout(1500);
await p.locator('select[aria-label=Network]').selectOption(chainId);
await p.waitForTimeout(1500);
log('create form header', (await p.locator('header').innerText()).replace(/\n/g, ' | '));
await p.fill('input[name=name]', 'QA Portfolio ' + chainId);
await p.fill('input[name=symbol]', 'QAP');
log('denom options', await p.locator('select[name=denomination] option').allInnerTexts());
await p.waitForTimeout(1500);
log('denom check', await txt('denomination-check'));
await p.waitForTimeout(3000); log('pre-create', (await p.locator('main').innerText()).replace(/\n/g,' / ').slice(0,600)); await p.getByRole('button', { name: /^Create portfolio$/ }).click({timeout:15000});
await p.waitForSelector('[data-testid=create-result], .notice-error, [role=alert]', { timeout: 90000 }).catch(() => {});
log('create result vault', await txt('result-vault'), 'comptroller', await txt('result-comptroller'));
await shot('1-created');
await p.getByRole('link', { name: /Open portfolio/ }).click();
await p.waitForSelector('[data-testid=portfolio]', { timeout: 30000 });
const url = p.url(); log('portfolio url', url);
await p.waitForTimeout(2500);
log('name', await txt('portfolio-name'), 'denom', await txt('portfolio-denomination'), 'owner', await txt('portfolio-owner'));
log('share price', await txt('portfolio-share-price'), 'nav', await txt('portfolio-nav'));
// deposit
await p.fill('input[aria-label="Deposit amount"]', '1000');
await p.waitForTimeout(2500);
log('deposit quote', await txt('deposit-quote'));
await p.getByRole('button', { name: /Approve & deposit/ }).click();
await p.waitForSelector('[data-testid=deposit-result]', { timeout: 90000 }).catch(async () => log('DEPOSIT FAIL', (await p.locator('main').innerText()).slice(0, 800)));
log('deposit', await txt('deposit-result'));
await p.waitForTimeout(2500);
log('after deposit: shares', await txt('portfolio-total-shares'), 'yours', await txt('portfolio-your-shares'), 'price', await txt('portfolio-share-price'), 'nav', await txt('portfolio-nav'));
log('holdings', await txt('holdings'));
await shot('2-deposited');
// reload (AC-6)
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('[data-testid=portfolio]'); await p.waitForTimeout(3000);
log('AFTER RELOAD: name', await txt('portfolio-name'), 'shares', await txt('portfolio-total-shares'), 'yours', await txt('portfolio-your-shares'), 'nav', await txt('portfolio-nav'));
await shot('3-reload');
// my portfolios
await p.goto(B + '/portfolio', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.locator('select[aria-label=Network]').selectOption(chainId).catch(() => {});
await p.waitForTimeout(6000);
log('my portfolios', await txt('my-portfolios'));
await shot('4-list');
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForSelector('[data-testid=portfolio]'); await p.waitForTimeout(2500);
// swap (after a hard navigation the wallet may be on another chain: use the app's switch button)
const sb = p.getByRole('button', { name: /Switch wallet to/ });
if (await sb.count()) { log('gate shown; switching wallet'); await sb.click(); await p.waitForTimeout(2500); }
const sw = p.getByTestId('swap-card');
if (await sw.count()) {
  const routes = await p.locator('select[aria-label="Swap route"] option').allInnerTexts();
  log('swap routes', routes);
  for (let r = 0; r < routes.length; r++) {
    await p.selectOption('select[aria-label="Swap route"]', { index: r });
    log(`route ${r} adapter`, await txt('swap-route-adapter'));
    const ins = await p.locator('select[aria-label="Asset in"] option').allInnerTexts();
    const outs = await p.locator('select[aria-label="Asset out"] option').allInnerTexts();
    log('in', ins, 'out', outs);
    await p.fill('input[aria-label="Swap amount"]', swapAmt);
    await p.getByRole('button', { name: /Get quote/ }).click();
    await p.waitForSelector('[data-testid=swap-quote]', { timeout: 90000 }).catch(()=>{});
    log('quote', await txt('swap-quote'));
    await p.getByRole('button', { name: /^Swap$/ }).click();
    await p.waitForSelector('[data-testid=swap-result]', { timeout: 90000 }).catch(async () => log('SWAP FAIL', (await p.locator('[data-testid=swap-card]').innerText()).slice(0, 800)));
    log('swap result', await txt('swap-result'), '| route', await txt('swap-result-route'), await p.getByTestId('swap-result-route').getAttribute('data-route-kind').catch(()=>null), '| adapter', await txt('swap-result-adapter'));
    await shot(`5-swap-${r}`);
    await p.waitForTimeout(2500);
    log('holdings', await txt('holdings'));
  }
} else log('swap card absent; disabled:', await txt('swap-disabled'));
// redeem
await p.fill('input[aria-label="Shares to redeem"]', '100');
await p.waitForTimeout(1500);
log('redeem preview', await txt('redeem-preview'));
await p.getByRole('button', { name: /Redeem/ }).last().click();
await p.waitForSelector('[data-testid=redeem-result]', { timeout: 90000 }).catch(async () => log('REDEEM FAIL', (await p.locator('[data-testid=redeem-card]').innerText()).slice(0, 800)));
log('redeem', await txt('redeem-result'));
await p.waitForTimeout(2500);
log('final: shares', await txt('portfolio-total-shares'), 'yours', await txt('portfolio-your-shares'), 'holdings', await txt('holdings'));
await shot('6-redeemed');
log('errs', JSON.stringify(errs.slice(0, 6)));
await b.close();
