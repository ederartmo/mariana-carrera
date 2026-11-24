
'use strict';
const {readFileSync}=require('node:fs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const premium = require('../support-premium.js');
const source = readFileSync(require.resolve('../support-premium.js'),'utf8');
const css = readFileSync(require.resolve('../support-premium.css'),'utf8');

test('ticket heading uses exactly the authorized ticket short folio, never other IDs or capabilities',()=>{
  const id='0825520b-710e-41e4-a4ea-4eca405ab31a';
  const ticket={id,token:'private-token',conversation_id:'unrelated-id',folio:'#BAD00000',owner_user_id:'private-owner'};
  assert.equal(premium.publicTicketHeading(ticket),'Mi solicitud: #0825520B');
  assert.equal(premium.publicTicketHeading({...ticket,id:'0825520b-0123-junk'}),'Mi solicitud');
  assert.equal(premium.publicTicketHeading({}), 'Mi solicitud');
  assert.equal(premium.publicTicketHeading(null), 'Mi solicitud');
  assert.equal(premium.publicTicketHeading({...ticket,id:'c5a1a711-c8f8-467b-be61-e10320f88645'}),'Mi solicitud: #C5A1A711');
});

test('both public ticket variants wire the text-only heading, and only the widget card adds message spacing on desktop and mobile',()=>{
  assert.equal([...source.matchAll(/<strong data-premium-ticket-heading>Mi solicitud<\/strong>/g)].length,2);
  assert.match(source,/card\.querySelector\('\[data-premium-ticket-heading\]'\)\.textContent = publicTicketHeading\(ticket\)/);
  assert.match(source,/premium-ticket-link[^\n]+\n[^\n]+data-support-previous[^\n]*\n[^\n]+data-support-messages/);
  assert.match(css,/\.premium-ticket-link\{margin-block:18px 14px;/);
  const mobile=css.slice(css.indexOf('@media(max-width:680px)'));
  assert.doesNotMatch(mobile,/\.premium-ticket(?:-link)?\s*\{[^}]*margin/);
  assert.match(css,/\.premium-support \[hidden\]\{display:none!important\}/);
});
