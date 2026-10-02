/**
 * QA driver (TEST-ONLY): negative test for unverified vaults, against a build made with the mock wallet + fork records
 * (README "QA: run the exact SHA..."). Deploy scripts/qa/FakeVault.sol on the fork first (see the file header), then:
 *
 *   node scripts/qa/qa-fork-unverified.mjs <chainId> <fakeVaultAddress> <rpcUrl>
 *   env: APP (default http://localhost:3100), PLAYWRIGHT_MODULE
 *
 * Checks: pasting the fake vault on /portfolio and deep-linking it both show `vault-unverified`; there is no deposit / redeem / swap
 * card; no transaction is sent (no eth_sendRawTransaction / eth_sendTransaction request, and the mock wallet's allowance to the fake
 * vault stays 0); a plain token address is rejected as "no vault".
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [chainId, fake, rpc] = process.argv.slice(2);
if (!chainId || !fake || !rpc) throw new Error('usage: qa-fork-unverified.mjs <chainId> <fakeVault> <rpcUrl>');
const B = process.env.APP || 'http://localhost:3100';
const slug = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum', 4663: 'robinhood' }[chainId];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1200 } });
const sent = [];
p.on('request', (r) => { const pd = r.postData() || ''; if (/eth_sendRawTransaction|eth_sendTransaction/.test(pd)) sent.push(pd.slice(0, 120)); });
await p.goto(B + '/create', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /^connect wallet$/i }).first().click();
await p.getByText('E2E Mock Wallet').first().click();
await p.waitForTimeout(1500);
await p.locator('select[aria-label=Network]').selectOption(chainId);

// 1. paste on /portfolio
await p.goto(B + '/portfolio', { waitUntil: 'networkidle' });
await p.locator('select[aria-label=Network]').selectOption(chainId);
await p.fill('input[aria-label="Vault address"]', fake);
await p.getByRole('button', { name: /^Open$/ }).click();
await p.waitForSelector('[data-testid=portfolio]', { timeout: 60000 });
const sb = p.getByRole('button', { name: /Switch wallet to/ });
if (await sb.count()) { await sb.click(); await p.waitForTimeout(1500); }
await p.waitForSelector('[data-testid=vault-unverified]', { timeout: 60000 });
const reason = await p.getByTestId('vault-unverified').getAttribute('data-reason');
check('pasted fake vault shows vault-unverified', true, `(reason=${reason})`);
await p.screenshot({ path: (process.env.OUT_DIR || '.') + '/qa-unverified.png', fullPage: true });
for (const id of ['deposit-card', 'redeem-card', 'swap-card']) check(`no ${id} for the unverified vault`, (await p.getByTestId(id).count()) === 0);
check('no Approve & deposit button', (await p.getByRole('button', { name: /Approve & deposit/ }).count()) === 0);

// 2. deep link (hard navigation)
await p.goto(`${B}/portfolio/${slug}/${fake}`, { waitUntil: 'networkidle' });
await p.waitForSelector('[data-testid=vault-unverified]', { timeout: 60000 });
check('deep-linked fake vault shows vault-unverified', true);
for (const id of ['deposit-card', 'redeem-card', 'swap-card']) check(`deep link: no ${id}`, (await p.getByTestId(id).count()) === 0);

// 3. not remembered under "My portfolios"
await p.goto(B + '/portfolio', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const saved = await p.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem('onchain-portfolio:saved-vaults:v1') ?? '{}'))));
check('fake vault is not saved in the browser', !saved.toLowerCase().includes(fake.toLowerCase()), saved === '[]' ? '' : `(saved=${saved.slice(0, 80)})`);

// 4. a plain token address is not a vault
await p.goto(`${B}/portfolio/${slug}/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
check('token address: no cards', (await p.getByTestId('deposit-card').count()) === 0 && (await p.getByTestId('redeem-card').count()) === 0);

// on-chain proof: the mock wallet (account 1) never approved the denomination token to the fake vault
const rpcCall = async (to, data) => (await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json()).result;
const token = '0x' + (await rpcCall(fake, '0x8bca6d16')).slice(-40);
const allowance = BigInt(await rpcCall(token, '0xdd62ed3e' + '70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase().padStart(64, '0') + fake.slice(2).toLowerCase().padStart(64, '0')));
check('allowance(mock wallet -> fake vault) is still 0', allowance === 0n, `(token ${token})`);
check('no transaction was sent by the browser at all', sent.length === 0, sent.length ? JSON.stringify(sent) : '');
await b.close();
if (results.includes(false)) { console.log('NEGATIVE TEST FAILED'); process.exit(1); }
console.log('NEGATIVE TEST OK');
