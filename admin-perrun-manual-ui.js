(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.createPerrunManualUI = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function({ document, event, uuid, escapeHtml, now = () => new Date(), isFormValid = () => true }) {
  const slug = document.getElementById('manualEventSlug');
  const wrapper = document.getElementById('manualPerrunDogs');
  const amount = document.getElementById('totalAmount');
  const total = document.getElementById('manualPerrunTotal');
  const save = document.getElementById('saveManualTransferBtn');
  const form = document.getElementById('manualTransferForm');
  const addTicket = document.getElementById('addManualTicketBtn');
  const dogs = [{ dog_name: '', dog_weight_kg: '', engraving_requested: false }, { dog_name: '', dog_weight_kg: '', engraving_requested: false }];
  let second = false, operation = null, busy = false;
  const isPerrun = () => slug.value === event.slug;
  function update() {
    if (!isPerrun()) return;
    const stage = event.pricing.getCurrentStage(now());
    const fee = second ? event.dogRules.secondDogFee : 0;
    amount.value = stage.isOpen ? stage.amount + fee : '';
    document.getElementById('manualPerrunPrice').textContent = stage.isOpen
      ? `${stage.label}: $${stage.amount} MXN · Segundo perro: +$${event.dogRules.secondDogFee} MXN · Grabado posterior: $${event.dogRules.engravingPaidPrice} por perro si aplica (no está incluido en el total). La elegibilidad gratuita se confirma al guardar.`
      : 'Inscripciones Perrun cerradas.';
    total.textContent = stage.isOpen ? `Total a registrar: $${amount.value} MXN` : 'Inscripciones cerradas';
    const selected = dogs.slice(0, second ? 2 : 1);
    const invalidPair = second && selected.some(dog => !Number.isFinite(Number(dog.dog_weight_kg)) || Number(dog.dog_weight_kg) < 3 || Number(dog.dog_weight_kg) > 25);
    const error = document.getElementById('manualPerrunDogError');
    error.hidden = !invalidPair;
    error.textContent = invalidPair ? 'Para registrar 2 perros, ambos deben ser categoría S o M (máximo 25 kg cada uno).' : '';
    const validDogs = selected.every(dog => dog.dog_name.trim() && [...dog.dog_name.trim()].length <= 80 && Number(dog.dog_weight_kg) >= 3 && Number(dog.dog_weight_kg) <= 80);
    save.disabled = busy || !stage.isOpen || invalidPair || !validDogs || !isFormValid();
    dogs.forEach((dog, index) => {
      let category = '—';
      try { category = event.categoryForWeight(Number(dog.dog_weight_kg)); } catch {}
      document.getElementById('manualDogCategory' + index).value = category;
    });
    const canAdd = dogs[0].dog_weight_kg !== '' && Number(dogs[0].dog_weight_kg) >= 3 && Number(dogs[0].dog_weight_kg) <= 25;
    document.getElementById('manualSecondDog').disabled = !second && !canAdd;
    document.getElementById('manualDogGroup1').hidden = !second;
  }
  function render() {
    const dogField = (dog, index) => `<fieldset id="manualDogGroup${index}"><legend>Perro ${index + 1}${index === 0 ? ' obligatorio' : ' opcional'}</legend><div class="manual-grid">
        <div><label>Nombre<input data-dog="${index}" data-field="dog_name" maxlength="80" value="${escapeHtml(dog.dog_name)}"></label></div>
        <div><label>Peso (kg)<input type="number" min="3" max="80" step="any" data-dog="${index}" data-field="dog_weight_kg" value="${escapeHtml(dog.dog_weight_kg)}"></label></div>
        <div><label>Categoría<input id="manualDogCategory${index}" readonly aria-readonly="true"></label></div>
        <div><label>Solicitar grabado<select data-dog="${index}" data-field="engraving_requested"><option value="false" ${!dog.engraving_requested ? 'selected' : ''}>No</option><option value="true" ${dog.engraving_requested ? 'selected' : ''}>Sí</option></select></label></div>
      </div></fieldset>`;
    wrapper.innerHTML = dogField(dogs[0], 0)
      + '<p id="manualPerrunPrice" class="cell-muted"></p>'
      + '<label class="manual-second-dog"><input type="checkbox" id="manualSecondDog" ' + (second ? 'checked' : '') + '> + Agregar segundo perro</label>'
      + dogField(dogs[1], 1)
      + '<p id="manualPerrunDogError" class="manual-feedback err" role="alert" aria-live="polite" hidden></p>';
    update();
  }
  wrapper.addEventListener('input', e => {
    const index = Number(e.target.dataset?.dog), field = e.target.dataset?.field;
    if (field && dogs[index]) {
      dogs[index][field] = field === 'engraving_requested' ? e.target.value === 'true' : e.target.value;
      update();
    }
  });
  wrapper.addEventListener('change', e => {
    if (e.target.id === 'manualSecondDog') {
      second = e.target.checked;
      if (!second) dogs[1] = { dog_name: '', dog_weight_kg: '', engraving_requested: false };
      render();
    }
  });
  function sync() {
    const active = isPerrun();
    wrapper.hidden = !active; total.hidden = !active; addTicket.hidden = active;
    amount.readOnly = active;
    if (active) render();
    else save.disabled = busy;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  function setBusy(value) { busy = value; if (isPerrun()) update(); }
  function payload(body) {
    const selected = dogs.slice(0, second ? 2 : 1).map(dog => ({ ...dog, dog_name: dog.dog_name.trim(), dog_weight_kg: Number(dog.dog_weight_kg) }));
    if (selected.some(dog => !dog.dog_name || [...dog.dog_name].length > 80)) throw new Error('Captura el nombre de cada perro (máximo 80 caracteres).');
    event.validateDogWeights(selected.map(dog => dog.dog_weight_kg));
    if (body.tickets.length !== 1) throw new Error('Perrun requiere exactamente un humano.');
    const signature = JSON.stringify({ buyerEmail: body.buyerEmail, distance: body.distance, tickets: body.tickets, dogs: selected, transferReference: body.transferReference });
    // Preserve identity and displayed amount on an identical retry, even across a tariff boundary.
    if (!operation || operation.signature !== signature) operation = { signature, id: uuid(), total: body.totalAmount };
    return { ...body, dogs: selected, manualPaymentId: operation.id, totalAmount: operation.total };
  }
  function reset() {
    operation = null; second = false;
    dogs.forEach((_, index) => dogs[index] = { dog_name: '', dog_weight_kg: '', engraving_requested: false });
    sync();
  }
  function refreshPrice() { operation = null; update(); }
  return { isPerrun, sync, payload, reset, update, refreshPrice, setBusy };
});
