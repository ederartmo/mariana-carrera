'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const start = source.indexOf('\nfunction setupCheckoutForm() {') + 1;
const end = source.indexOf('// NOTA Batch 1A:', start);
assert.ok(start > 0 && end > start, 'checkout handler must be present in script.js');

function browserBinary() {
  const candidates = [
    process.env.KINETICHUB_TEST_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

const chrome = browserBinary();
test('Browser: rejecting a higher Cascanueces price does not continue or navigate to Stripe', { skip: !chrome && 'Chromium/Chrome unavailable' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinetichub-price-browser-'));
  try {
    const html = `<!doctype html><meta charset="utf-8"><title>Cascanueces checkout fixture</title>
      <form id="checkoutForm"><input id="userEmail" value="runner@example.invalid"><input id="termsCheck" type="checkbox" checked>
      <button type="submit">Continuar al pago</button></form>
      <button id="addTicketBtn" type="button"></button><div id="ticketsList"></div>
      <span id="stagePrice">$450 MXN</span><span id="stageLabel">Acceso General</span>
      <span id="totalPrice"></span><span id="ticketCountLabel"></span>
      <input id="promoCode"><button id="applyPromoBtn" type="button"></button>
      <div id="promoFeedback"></div><div id="discountRow"></div><div id="discountLabel"></div>
      <div id="discountValue"></div><div id="finalTotalRow"></div><div id="finalTotalPrice"></div>
      <pre id="result"></pre>
      <script>
      window.KineticHubCheckoutSelection = { eventSlug: 'cascanueces-run', distance: '5K' };
      window.KineticHubBirthDate = {
        markup: ({ id }) => '<input id="' + id + '" data-ticket-index="0" data-ticket-field="birthDate">'
      };
      window.requests = []; window.confirmations = []; window.alerts = [];
      window.confirm = message => { window.confirmations.push(message); return false; };
      window.alert = message => window.alerts.push(message);
      window.fetch = async (url, options) => {
        window.requests.push({ url, body: JSON.parse(options.body) });
        if (window.requests.length !== 1) throw Error('Checkout continued after rejection');
        return { ok: false, status: 409, text: async () => JSON.stringify({
          code: 'PRICE_CHANGED', unitAmount: 500, stageLabel: 'Extemporánea', currency: 'MXN'
        }) };
      };
      ${source.slice(start, end)}
      setupCheckoutForm();
      const input = (id, value, type = 'input') => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event(type, { bubbles: true }));
      };
      input('ticketName1', 'Runner Test');
      input('ticketShirt1', 'M');
      input('ticketBirth1', '1990-05-14', 'change');
      input('ticketWa1', '5512345678');
      input('ticketState1', 'Jalisco', 'change');
      document.getElementById('checkoutForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      setTimeout(() => {
        // A retry after "No" must ask again without issuing another checkout request.
        document.getElementById('checkoutForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        setTimeout(() => {
          document.getElementById('result').textContent = btoa(JSON.stringify({
            requests: window.requests, confirmations: window.confirmations,
            alerts: window.alerts, location: location.href,
            stagePrice: document.getElementById('stagePrice').textContent,
            buttonDisabled: document.querySelector('#checkoutForm button[type=submit]').disabled
          }));
        }, 150);
      }, 150);
      </script>`;
    const fixture = path.join(temp, 'checkout.html');
    fs.writeFileSync(fixture, html);
    const run = spawnSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--virtual-time-budget=2000', `--user-data-dir=${path.join(temp, 'profile')}`,
      '--dump-dom', pathToFileURL(fixture).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    const match = run.stdout.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/);
    assert.ok(match, `Browser did not complete fixture: ${run.stdout.slice(-500)}`);
    const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    assert.equal(result.requests.length, 1, `no second checkout request after rejection: ${JSON.stringify(result)}`);
    assert.equal(result.requests[0].url, '/api/create-checkout-session');
    assert.equal(result.requests[0].body.expectedUnitAmount, 450);
    assert.equal(result.confirmations.length, 2, 'retry must require explicit confirmation again');
    assert.match(result.confirmations[0], /\$500 MXN/);
    assert.equal(result.stagePrice, '$500 MXN');
    assert.equal(result.buttonDisabled, false);
    assert.deepEqual(result.alerts, []);
    assert.equal(result.location, pathToFileURL(fixture).href, 'browser must remain on checkout');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
