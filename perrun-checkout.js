(function (root) {
  'use strict';
  function birthISO(day, month, year, now = new Date()) {
    if (!/^\d{4}$/.test(String(year)) || !/^\d{1,2}$/.test(String(day)) || !/^\d{1,2}$/.test(String(month))) return '';
    const y = Number(year), m = Number(month), d = Number(day);
    const date = new Date(Date.UTC(y, m - 1, d));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (y < 1900 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date.getTime() >= today) return '';
    return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  root.KineticHubPerrunCheckout = {
    birthISO,
    birthMarkup(number, index, iso = '') {
      const [year = '', month = '', day = ''] = iso.split('-');
      const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return '<fieldset class="perrun-birth" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend>Fecha de nacimiento *</legend><div style="display:flex;gap:12px;flex-wrap:wrap">' +
        '<label>Día<input aria-label="Día de nacimiento" type="number" min="1" max="31" placeholder="DD" autocomplete="bday-day" data-birth-part="day" data-ticket-index="'+index+'" value="'+day+'" required></label>' +
        '<label>Mes<select aria-label="Mes de nacimiento" autocomplete="bday-month" data-birth-part="month" data-ticket-index="'+index+'" required><option value="">Mes</option>'+months.map((name, i)=>'<option value="'+(i+1)+'" '+(Number(month)===i+1?'selected':'')+'>'+name+'</option>').join('')+'</select></label>' +
        '<label>Año<input aria-label="Año de nacimiento" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="AAAA" autocomplete="bday-year" data-birth-part="year" data-ticket-index="'+index+'" value="'+year+'" required></label>' +
        '</div><input type="hidden" id="ticketBirth'+number+'" data-ticket-field="birthDate" data-ticket-index="'+index+'" value="'+iso+'"></fieldset>';
    },
    updateBirth(target, ticket) {
      const group = target.closest('.perrun-birth');
      const part = name => group.querySelector('[data-birth-part="'+name+'"]');
      const day = part('day'), month = part('month'), year = part('year');
      const iso = birthISO(day.value, month.value, year.value);
      const complete = day.value && month.value && year.value.length === 4;
      const days = Number(month.value) && /^\d{4}$/.test(year.value) ? new Date(Date.UTC(Number(year.value), Number(month.value), 0)).getUTCDate() : 31;
      day.max = String(days);
      day.setCustomValidity(complete && !iso ? 'Ingresa una fecha real, anterior a hoy y desde 1900.' : '');
      group.querySelector('[data-ticket-field="birthDate"]').value = iso;
      ticket.birthDate = iso;
    },
    create({ form, onChange }) {
      const event = root.KineticHubPerrunEvent;
      if (!event) throw new Error('No se pudo cargar la configuración de Perrun.');
      const section = document.getElementById('perrunDogs');
      const second = document.getElementById('perrunSecondDog');
      const toggle = document.getElementById('perrunAddDog');
      const firstWeight = document.getElementById('perrunDogWeight1');
      let previousWeight = firstWeight.value;
      let cachedQuote = null;
      let currentAttemptStorageKey = null;
      // One identity per unchanged form, also shared by tabs/reloads. No personal data is stored.
      async function attemptFor(key) {
        const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
        const storageKey = 'perrun-v2-attempt/' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        currentAttemptStorageKey = storageKey;
        const assign = () => {
          let id = root.localStorage.getItem(storageKey);
          if (!id) { id = root.crypto.randomUUID(); root.localStorage.setItem(storageKey, id); }
          return id;
        };
        return root.navigator?.locks ? root.navigator.locks.request(storageKey, assign) : assign();
      }
      section.hidden = false;
      document.getElementById('perrunCopyFee').textContent = '$'+event.dogRules.secondDogFee+' MXN';
      function updateSummary(baseAmount, quote) {
        const fee = quote ? quote.secondDogFee : (toggle.checked ? event.dogRules.secondDogFee : 0);
        document.getElementById('summaryBaseLabel').textContent = 'Inscripción + 1 perro · ';
        document.getElementById('summaryQuantityLabel').textContent = 'Participantes';
        document.getElementById('ticketCountLabel').textContent = '1';
        document.getElementById('perrunDogCountRow').hidden = false;
        document.getElementById('perrunDogCount').textContent = toggle.checked ? '2' : '1';
        document.getElementById('perrunSecondPriceRow').hidden = !toggle.checked;
        document.getElementById('perrunSecondPrice').textContent = '+$'+fee+' MXN';
        document.getElementById('perrunEngravingPriceRow').hidden = false;
        document.getElementById('perrunEngravingPrice').textContent = quote ? '$'+(quote.engravingAmount || 0)+' MXN' : 'Por confirmar';
        document.getElementById('summaryTotalLabel').textContent = quote ? 'Total confirmado' : 'Subtotal · Grabado por confirmar';
        if (quote) document.getElementById('stagePrice').textContent = '$'+quote.baseAmount+' MXN';
        document.getElementById('totalPrice').textContent = '$'+(quote ? quote.total : baseAmount + fee)+' MXN';
      }
      function dog(index) {
        return { dog_name: document.getElementById('perrunDogName' + index).value.trim(),
          dog_weight_kg: Number(document.getElementById('perrunDogWeight' + index).value),
          engraving_requested: document.getElementById('perrunEngraving' + index).checked };
      }
      function resetSecond() {
        toggle.checked = false;
        document.getElementById('perrunDogName2').value = '';
        document.getElementById('perrunDogWeight2').value = '';
        document.getElementById('perrunEngraving2').checked = false;
      }
      function refresh() {
        let firstCategory = null;
        try { firstCategory = event.categoryForWeight(Number(firstWeight.value)); } catch { /* incomplete weight */ }
        const eligible = firstCategory === 'S' || firstCategory === 'M';
        toggle.disabled = !eligible;
        second.hidden = !toggle.checked;
        second.querySelectorAll('input').forEach(input => { input.disabled = !toggle.checked; });
        for (const i of [1, 2]) {
          const output = document.getElementById('perrunDogCategory' + i);
          try { output.textContent = event.categoryForWeight(Number(document.getElementById('perrunDogWeight' + i).value)); }
          catch { output.textContent = 'Ingresa un peso entre 3 y 80 kg'; }
        }
        document.getElementById('perrunSecondFee').hidden = !toggle.checked;
        onChange();
      }
      firstWeight.addEventListener('change', () => {
        let category;
        try { category = event.categoryForWeight(Number(firstWeight.value)); } catch { category = null; }
        if (toggle.checked && category !== 'S' && category !== 'M') {
          if (!root.confirm('Este peso permite un solo perro. ¿Quitar el segundo perro y sus datos?')) {
            firstWeight.value = previousWeight; refresh(); return;
          }
          resetSecond();
        }
        previousWeight = firstWeight.value;
        refresh();
      });
      toggle.addEventListener('change', () => { if (!toggle.checked) resetSecond(); refresh(); });
      section.addEventListener('change', refresh);
      form.addEventListener('input', () => { cachedQuote = null; });
      form.addEventListener('change', () => { cachedQuote = null; });
      async function request(body) {
        const response = await fetch('/api/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) {
          // A timeout may follow Stripe creation. Keep the SAME reservation and idempotency key.
          if (data.newAttemptRequired) { root.localStorage.removeItem(currentAttemptStorageKey); cachedQuote = null; }
          throw new Error(data.error || 'No se pudo preparar el checkout.');
        }
        return data;
      }
      return {
        updateSummary,
        secondDogFee: () => toggle.checked ? event.dogRules.secondDogFee : 0,
        refresh,
        async submit(payload) {
          const dogs = toggle.checked ? [dog(1), dog(2)] : [dog(1)];
          if (dogs.some(item => !item.dog_name)) throw new Error('Captura el nombre de cada perro.');
          event.validateDistance(payload.distance);
          event.validateDogWeights(dogs.map(item => item.dog_weight_kg));
          const body = { ...payload, dogs, promoCode: '' };
          const key = JSON.stringify(body);
          if (!cachedQuote || cachedQuote.key !== key) {
            const quote = await request({ ...body, action: 'quote', attemptId: await attemptFor(key) });
            cachedQuote = { key, token: quote.quoteToken, reservationId: quote.reservationId, quote };
            updateSummary(quote.baseAmount, quote);
          }
          const quote = cachedQuote.quote;
          const benefits = (quote.benefits || []).map(d => 'Perro '+d.dogIndex+': '+(d.free ? 'beneficio gratuito reservado' : d.engravingRequested ? 'grabado $35 MXN' : 'grabado no solicitado')).join('\n');
          if (quote.pricingModelVersion === 2 && !root.confirm('Inscripción: $'+quote.baseAmount+' MXN\nSegundo perro: $'+quote.secondDogFee+' MXN\n'+benefits+'\nGrabado solicitado: $'+quote.engravingAmount+' MXN\nTotal de este único pago: $'+quote.total+' MXN\n\n¿Continuar al pago?')) return { cancelled: true };
          document.getElementById('perrunEngravingCopy').textContent = quote.pricingModelVersion === 2
            ? 'El beneficio reservado y el grabado solicitado están incluidos en el total confirmado. No habrá un segundo pago de grabado.'
            : 'El grabado gratuito se confirma al pagar. Si no aplica, el grabado opcional de $35 MXN se paga posteriormente.';
          return request({ ...body, action: 'create', reservationId: cachedQuote.reservationId, quoteToken: cachedQuote.token });
        },
      };
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
