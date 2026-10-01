"use strict";
// Existing Kinetic Hub sender and webhook-owned Resend client, shared by Perrun flows.
const FROM = 'Kinetic Hub <no-reply@kinetichub.com.mx>';
async function sendTransactionalEmail({resend, mockProvider, payload, idempotencyKey, mockId}) {
  if (mockProvider) return mockProvider.emails.send({from: FROM, ...payload}, {idempotencyKey});
  if (process.env.PERRUN_QA_LOCAL === '1') {
    if (!mockId) throw new Error('QA email transport blocked');
    return {data: {id: mockId}};
  }
  if (!resend?.emails?.send) throw new Error('Resend transport unavailable');
  return resend.emails.send({from: FROM, ...payload}, {idempotencyKey});
}
module.exports = {FROM, sendTransactionalEmail};
