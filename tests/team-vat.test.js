/* team.html — no VAT while RAFD is not VAT-registered.
   Runs the page in demo mode (Supabase constants emptied) in Chromium:
     node tests/team-vat.test.js
   Needs the global `playwright` package (preinstalled in the build image). */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'team.html'), 'utf8')
  .replace(/const SUPABASE_URL\s*=\s*'[^']*'/, "const SUPABASE_URL = ''")
  .replace(/const SUPABASE_ANON_KEY\s*=\s*'[^']*'/, "const SUPABASE_ANON_KEY = ''");
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/team') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  res.writeHead(404); res.end();
});

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + String(detail).slice(0, 160)}`); if (!ok) failed++; };
const VAT_WORDS = /ضريبة القيمة المضافة|قبل الضريبة|شامل الضريبة|\bVAT\b/;

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/team`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage();
  page.on('pageerror', e => { failed++; console.log('FAIL page error — ' + e.message); });
  await page.goto(base);

  check('VAT_REGISTERED is false', await page.evaluate(() => typeof VAT_REGISTERED !== 'undefined' && VAT_REGISTERED === false));

  // a representative, a client, a quote request — through the demo's own RPCs
  const ids = await page.evaluate(async () => {
    const reg = await rpc('team_register', { p_name: 'ممثل تجربة', p_phone: '0500000001', p_city: 'الرياض', p_tiktok: '',
      p_password: 'secret123', p_agree: true, p_invite: '' });
    store(TOKEN_KEY, reg.token);
    const lead = await rpc('team_add_lead', { p_token: reg.token, p_name: 'عميل', p_company: 'شركة', p_phone: '0511111111',
      p_city: 'الرياض', p_service: SERVICE_LIST[0], p_notes: '' });
    const req = await rpc('team_quote_request', { p_token: reg.token, p_lead: lead.id, p_details: 'عشر خدمات', p_items: null });
    return { reg, lead, req };
  });
  check('demo flow created a lead and a quote request', !!(ids.lead && ids.lead.id && ids.req && !ids.req.error), JSON.stringify(ids));

  const sent = await page.evaluate(async leadId => {
    const d = JSON.parse(store(DEMO_KEY));
    const secret = d.adminSecret || 'demo';
    // the operator asks for VAT explicitly — an unregistered company must still get none
    const r = await rpc('team_admin', { p_secret: secret, p_action: 'quote_send',
      p: { lead_id: leadId, vat: true, items: [{ d: 'الباقة الأساسية', q: 10, p: 349 }] } });
    const q = JSON.parse(store(DEMO_KEY)).quotes.find(x => x.lead_id === leadId);
    return { r, q };
  }, ids.lead.id);
  check('quote_send ignores vat:true while unregistered', sent.q && sent.q.vat === false && sent.q.total === 3490,
        JSON.stringify(sent));

  // the quote page a client opens
  await page.goto(`${base}#/q/${sent.q.id}`); await page.waitForSelector('.qdoc');
  const text = await page.locator('.qdoc').innerText();
  check('quote without VAT shows no VAT wording', !VAT_WORDS.test(text), (text.match(VAT_WORDS) || [])[0]);
  check('the ZATCA distinguished number is never labelled a VAT number', /الرقم المميز لدى هيئة الزكاة والضريبة والجمارك: 3142275087/.test(text) && !/رقم ضريبي/.test(text));
  check('quote without VAT has no VAT column', await page.locator('table.qd thead th').count() === 4);
  check('quote without VAT shows the total 3,490', /3,490/.test(text));

  // a quote sent earlier WITH VAT keeps what the client was given
  const oldId = await page.evaluate(() => {
    const d = JSON.parse(store(DEMO_KEY)); const q = d.quotes[0];
    const old = { ...q, id: 'old-vat-quote', no: q.no + 1, lead_id: q.lead_id + '-old', vat: true, total: 4013.5 };
    d.quotes.push(old); d.leads.push({ ...d.leads.find(l => l.id === q.lead_id), id: old.lead_id });
    store(DEMO_KEY, JSON.stringify(d)); return old.id;
  });
  await page.goto(`${base}#/q/${oldId}`); await page.reload(); await page.waitForSelector('.qdoc');
  const oldText = await page.locator('.qdoc').innerText();
  check('a quote sent earlier with VAT still shows its 15%', /15%/.test(oldText) && /4,013/.test(oldText));

  // the representative's price guide
  await page.goto(base); await page.waitForTimeout(300);
  const prices = await page.evaluate(() => { openPrices(); return document.querySelector('#priceCard').innerText; });
  check('price guide says nothing about VAT', !VAT_WORDS.test(prices), (prices.match(VAT_WORDS) || [])[0]);
  check('price guide tells the rep nothing is added', /لا يُضاف عليها شيء|nothing is added/.test(prices));

  // the operator's quote editor offers no VAT option
  const editor = await page.evaluate(async leadId => {
    const d = JSON.parse(store(DEMO_KEY)); const l = d.leads.find(x => x.id === leadId);
    admCatalog = DEFAULT_CATALOG;                     // what viewAdmin() loads before any editor opens
    try { openQuoteEditor({ ...l, quote: d.quotes.find(q => q.lead_id === leadId) }); } catch (e) { return 'error: ' + e.message; }
    await new Promise(r => setTimeout(r, 200));
    const f = document.querySelector('#ef'); return f ? { vatBox: !!f.querySelector('input[name=vat]'), text: f.innerText } : 'no editor';
  }, ids.lead.id);
  check('operator editor has no "Add 15% VAT" option', typeof editor === 'object' && !editor.vatBox && !/15%/.test(editor.text),
        JSON.stringify(editor).slice(0, 200));

  await browser.close(); server.close();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
