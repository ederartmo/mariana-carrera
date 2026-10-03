'use strict';
// Confirmed ledger only. Callers must authenticate before using this service client reader.
const SLUG = 'perrun-2027';
const DOG_COLUMNS = 'id,registration_id,registration_email,order_session_id,dog_index,dog_name,weight_kg,category,engraving_sequence,engraving_requested,engraving_free,engraving_payment_required,engraving_payment_amount_cents,plate_status,plate_started_at,dog_name_for_plate,owner_phone_for_plate,pricing_model_version,promo_slot,engraving_state';
function engravingStatus(dog) {
  if (!dog.engraving_requested) return 'Grabado no solicitado';
  if (dog.engraving_free) return 'Grabado gratuito confirmado';
  if (dog.pricing_model_version === 2 && dog.engraving_state === 'included_paid') return 'Grabado pagado · Incluido en la inscripción';
  if (dog.engraving_payment_status === 'paid') return 'Grabado pagado';
  if (dog.engraving_payment_status === 'refunded') return 'Pago de grabado reembolsado';
  return 'Grabado solicitado · Pago pendiente $35 MXN';
}
async function enrichRegistrations(client, rows, { profile = false } = {}) {
  const perrun = rows.filter(row => row.event_slug === SLUG);
  if (!perrun.length) return rows;
  let result = await client.from('registration_dogs').select(DOG_COLUMNS)
    .in('registration_id', perrun.map(row => row.id)).order('dog_index', { ascending: true });
  if (result.error?.code === '42703' && process.env.PERRUN_PAYMENT_V2 !== '1') result = await client.from('registration_dogs').select(DOG_COLUMNS.replace(',pricing_model_version,promo_slot,engraving_state','')).in('registration_id', perrun.map(row => row.id)).order('dog_index', { ascending: true });
  if (result.error) throw new Error('No se pudo leer el ledger Perrun.');
  const dogs = result.data || [];
  let payments = [];
  if (dogs.length) {
    const result = await client.from('perrun_engraving_payments').select('dog_id,status')
      .in('dog_id', dogs.map(dog => dog.id)).in('status', ['paid', 'refunded']);
    if (result.error) throw new Error('No se pudo leer el estado del grabado.');
    payments = result.data || [];
  }
  let orders = [];
  if (!profile) {
    const result = await client.from('perrun_checkout_orders').select('order_session_id,owner_phone,finalized_at,payment_status,dogs')
      .in('order_session_id', perrun.map(row => row.order_session_id));
    if (result.error) throw new Error('No se pudo leer la orden Perrun.');
    orders = result.data || [];
  }
  return rows.map(row => {
    if (row.event_slug !== SLUG) return row;
    const owned = dogs.filter(dog => String(dog.registration_id) === String(row.id) && dog.registration_email === row.email);
    const order = orders.find(order => order.order_session_id === row.order_session_id);
    if (!profile && (!order || !order.finalized_at || !Array.isArray(order.dogs) || owned.length !== order.dogs.length || owned.length < 1 || owned.length > 2 || order.payment_status !== 'paid')) throw new Error('Ledger Perrun incompleto.');
    if (profile && !owned.length) throw new Error('Ledger Perrun incompleto.');
    const details = owned.map(dog => {
      const payment = payments.find(payment => payment.dog_id === dog.id);
      const enriched = { ...dog, dog_weight_kg: dog.weight_kg, dog_size: dog.category, engraving_payment_amount: dog.engraving_payment_amount_cents, engraving_payment_status: dog.pricing_model_version === 2 ? dog.engraving_state === 'included_paid' ? 'paid' : dog.engraving_state : payment?.status || (dog.engraving_free ? 'free' : dog.engraving_requested ? 'pending' : 'not_requested') };
      enriched.engraving_status = engravingStatus(enriched);
      enriched.engraving_paid = payment?.status === 'paid' || dog.engraving_state === 'included_paid';
      enriched.can_pay_engraving = dog.engraving_requested && !dog.engraving_free && dog.engraving_payment_required && !['paid','refunded'].includes(payment?.status) && ['paid','paid_no_email'].includes(row.payment_status) && row.registration_status === 'active';
      return profile ? { dog_index: dog.dog_index, dog_name: dog.dog_name, dog_category: dog.category, engraving_status: enriched.engraving_status, can_pay_engraving: enriched.can_pay_engraving } : enriched;
    });
    return { ...row, ...(profile ? {} : { owner_phone: row.whatsapp || order.owner_phone }), dogs: details };
  });
}
const CSV_COLUMNS = ['event_slug','distance','bib_number','participant_name','participant_email','owner_phone','shirt_size','dog_index','dog_name','dog_weight_kg','dog_category','engraving_sequence','engraving_requested','engraving_free','engraving_payment_required','engraving_payment_amount','engraving_payment_status','payment_status','registration_status','plate_status','plate_started_at','dog_name_for_plate','owner_phone_for_plate','engraving_paid','engraving_status'];
function csvCell(value) {
  let text = String(value ?? '');
  // Quote every cell and neutralize spreadsheet formulas, including phone prefixes.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function perrunCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    if (row.event_slug !== SLUG) continue;
    for (const dog of row.dogs || []) {
      const values = { ...row, ...dog, bib_number: String(row.bib_number || row.cancelled_bib_number || '').padStart(3, '0'), participant_name: row.full_name, participant_email: row.email, owner_phone: row.owner_phone, dog_category: dog.dog_size };
      lines.push(CSV_COLUMNS.map(column => csvCell(values[column])).join(','));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
module.exports = { SLUG, DOG_COLUMNS, engravingStatus, enrichRegistrations, CSV_COLUMNS, csvCell, perrunCsv };
