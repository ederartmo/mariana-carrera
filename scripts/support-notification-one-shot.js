'use strict';

// Operator CLI only. Do not import into an API handler or scheduler.
const TICKET = 'c1af3583-e738-4bb8-af30-2dbfd3910aac';
const RECIPIENT = 'soporte@kinetichub.com.mx';
const PROJECT = 'https://uycwzhlcnfijjyzkgkem.supabase.co';
const LINK = 'https://www.kinetichub.com.mx/admin-inscripciones.html';
const WINDOW_MS = 10 * 60 * 1000;

function settings(args, env, now = Date.now) {
  const raw = env.SUPPORT_NOTIFICATION_TEST_EXPIRES_AT || '';
  const expires = Date.parse(raw);
  const time = now();
  const from = (env.SUPPORT_NOTIFICATION_FROM || '').trim();
  if (args.length !== 1 || args[0] !== '--send-once' ||
      env.SUPPORT_NOTIFICATIONS_ENABLED !== 'false' || env.SUPABASE_URL !== PROJECT ||
      !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !from || /[\r\n]/.test(from) ||
      !Number.isFinite(expires) || new Date(expires).toISOString() !== raw ||
      expires <= time || expires - time > WINDOW_MS) throw new Error('invalid operator configuration');
  return {now, expires, from, key:env.RESEND_API_KEY};
}

async function sendOnce({now, expires, from, key, lookup, reserve, accepted, fetcher}) {
  if (now() >= expires) return 'expired';
  const ticket = await lookup(TICKET);
  if (ticket?.id !== TICKET || ticket.status !== 'pending' ||
      !Number.isFinite(Date.parse(ticket.created_at))) return 'ticket_not_pending';
  if (now() >= expires) return 'expired';
  // Commit a terminal row BEFORE contacting Resend. The existing unique constraint
  // lets exactly one invocation proceed, and the normal worker cannot lease this row.
  const id = await reserve({ticket_id:TICKET, kind:'new', source_id:TICKET,
    occurred_at:ticket.created_at, state:'stopped', attempts:1, first_attempt_at:new Date(now()).toISOString()});
  if (!id) return 'already_reserved';
  if (now() >= expires) return 'expired_after_reservation';
  let response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'support-notification/'+id},
      body:JSON.stringify({from,to:[RECIPIENT],subject:'[PRUEBA] Kinetic Hub · Atención requerida #C1AF3583',
        text:'Aviso único de prueba\nFolio: #C1AF3583\nMotivo: Nuevo\nFecha (UTC): '+new Date(ticket.created_at).toISOString()+
          '\nEstado: Pendiente\nBandeja: '+LINK+'\nResponde únicamente desde la bandeja administrativa.'})
    });
  } catch { return 'provider_unconfirmed'; }
  if (!response.ok) return 'provider_unconfirmed';
  try { await accepted(id); } catch { return 'provider_accepted_record_unconfirmed'; }
  return 'provider_accepted';
}

async function main(args, env) {
  const config = settings(args, env);
  const {createClient} = require('@supabase/supabase-js');
  const db = createClient(PROJECT, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  return sendOnce({...config, fetcher:fetch,
    lookup:async id => {
      const {data,error} = await db.from('support_tickets').select('id,status,created_at').eq('id',id).maybeSingle();
      if (error) throw new Error('ticket lookup failed');
      return data;
    },
    reserve:async row => {
      const {data,error} = await db.from('support_notification_jobs').upsert(row,{onConflict:'kind,source_id',ignoreDuplicates:true}).select('id').maybeSingle();
      if (error) throw new Error('reservation unconfirmed');
      return data?.id;
    },
    accepted:async id => {
      const {data,error} = await db.from('support_notification_jobs').update({state:'sent'}).eq('id',id)
        .eq('ticket_id',TICKET).eq('kind','new').eq('source_id',TICKET).eq('state','stopped').eq('attempts',1)
        .select('id').maybeSingle();
      if (error || data?.id !== id) throw new Error('acceptance update unconfirmed');
    }
  });
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then(result => {
    console.log(result);
    if (result !== 'provider_accepted') process.exitCode = 1;
  }, () => { console.error('aborted_or_unconfirmed; investigate without retrying'); process.exitCode = 1; });
}
module.exports = {sendOnce, settings, main, TICKET};
