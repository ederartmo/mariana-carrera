(function (root) {
  'use strict';
  root.KineticHubPerrunCheckout = {
    create({ form, onChange }) {
      const event = root.KineticHubPerrunEvent;
      if (!event) throw new Error('No se pudo cargar la configuración de Perrun.');
      const section = document.getElementById('perrunDogs');
      const second = document.getElementById('perrunSecondDog');
      const toggle = document.getElementById('perrunAddDog');
      const firstWeight = document.getElementById('perrunDogWeight1');
      let previousWeight = firstWeight.value;
      let cachedQuote = null;
      section.hidden = false;
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
          if (response.status === 409 || response.status === 503) cachedQuote = null;
          throw new Error(data.error || 'No se pudo preparar el checkout.');
        }
        return data;
      }
      return {
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
            const quote = await request({ ...body, action: 'quote' });
            cachedQuote = { key, token: quote.quoteToken };
            document.getElementById('totalPrice').textContent = `$${quote.total} MXN`;
          }
          return request({ ...body, action: 'create', quoteToken: cachedQuote.token });
        },
      };
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
