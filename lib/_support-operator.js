'use strict';

const { getAuthenticatedUser, getAdminEmails, normalizeEmail } = require('./_auth');
const { UUID } = require('./_support');

function operatorEmails() {
  return (process.env.SUPPORT_OPERATOR_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
}

function getSupportAssignees() {
  return [...new Set([...getAdminEmails(), ...operatorEmails()])];
}

async function getSupportOperator(req, options = {}) {
  const auth = await getAuthenticatedUser(req, options);
  if (auth.error) return auth;
  if ((options.adminEmails || getAdminEmails()).includes(auth.email)) return auth;
  if (operatorEmails().includes(auth.email) && typeof auth.user.id === 'string' &&
      UUID.test(auth.user.id) && auth.user.email_confirmed_at && !auth.user.is_anonymous) return auth;
  return { error: 'No autorizado para soporte.', status: 403 };
}

module.exports = { getSupportOperator, getSupportAssignees };
