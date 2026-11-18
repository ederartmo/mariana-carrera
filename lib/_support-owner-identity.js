const { UUID, hashCapability } = require('./_support');
const validId = value => typeof value === 'string' && UUID.test(value);

function displayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/gu, ' ').trim();
  // The profile name is user-entered; do not present an email, UUID or control characters as a name.
  if (!name || name.length > 120 || name.includes('@') || validId(name) || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return name;
}

async function ownerIdentities(client, tickets) {
  const identities = new Map();
  if (!Array.isArray(tickets) || tickets.length > 50 || typeof client?.from !== 'function') return identities;
  const ticketIds = [...new Set(tickets.map(ticket => ticket?.id).filter(validId))];
  if (!ticketIds.length) return identities;

  const { data: links, error: linkError } = await client.from('support_tickets')
    .select('id, owner:support_conversations!support_tickets_conversation_id_fkey(owner_user_id, capability_hash)')
    .in('id', ticketIds);
  if (linkError || !Array.isArray(links)) return identities;
  const allowedTickets = new Set(ticketIds);
  const verifiedLinks = new Map();
  for (const { id, owner } of links) {
    const userId = owner?.owner_user_id;
    if (allowedTickets.has(id) && validId(userId) &&
        owner.capability_hash === hashCapability('support-owner:' + userId.toLowerCase())) verifiedLinks.set(id, userId);
  }
  const userIds = [...new Set(verifiedLinks.values())];
  if (!userIds.length) return identities;

  const { data: profiles, error: profileError } = await client.from('user_profiles')
    .select('user_id, full_name').in('user_id', userIds);
  if (profileError || !Array.isArray(profiles)) return identities;
  // The documented user_profiles PK/FK guarantees one profile bound to the authentic account.
  const names = new Map(profiles.map(profile => [profile.user_id, displayName(profile.full_name)]));
  for (const [id, userId] of verifiedLinks) {
    if (names.has(userId)) identities.set(id, { displayName: names.get(userId), authenticated: true });
  }
  return identities;
}

async function withOwnerIdentity(client, data) {
  const tickets = Array.isArray(data.tickets) ? data.tickets : data.ticket ? [data.ticket] : [];
  let identities;
  try { identities = await ownerIdentities(client, tickets); }
  catch { return data; }
  if (!identities.size) return data;
  const enrich = ticket => {
    const identity = identities.get(ticket?.id);
    return identity ? { ...ticket, identity } : ticket;
  };
  return Array.isArray(data.tickets) ? { ...data, tickets: tickets.map(enrich) } : { ...data, ticket: enrich(data.ticket) };
}
module.exports = { withOwnerIdentity };
