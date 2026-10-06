(function (root) {
  'use strict';
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function birthISO(day, month, year, now = new Date()) {
    if (!/^\d{4}$/.test(String(year)) || !/^\d{1,2}$/.test(String(day)) || !/^\d{1,2}$/.test(String(month))) return '';
    const y = Number(year), m = Number(month), d = Number(day);
    const date = new Date(Date.UTC(y, m - 1, d));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (y < 1900 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date.getTime() >= today) return '';
    return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function markup({ id, iso = '', required = false, index = '', name = '' }) {
    const [year = '', month = '', day = ''] = String(iso).slice(0, 10).split('-');
    const requiredAttr = required ? ' required' : '';
    const indexAttr = index === '' ? '' : ' data-ticket-index="' + index + '"';
    const hiddenName = name ? ' name="' + name + '"' : '';
    return '<div class="kh-birth-date" data-birth-group><div class="kh-birth-date-parts">' +
      '<label>Día<input aria-label="Día de nacimiento" type="number" min="1" max="31" placeholder="DD" autocomplete="bday-day" data-birth-part="day"' + indexAttr + ' value="' + day + '"' + requiredAttr + '></label>' +
      '<label>Mes<select aria-label="Mes de nacimiento" autocomplete="bday-month" data-birth-part="month"' + indexAttr + requiredAttr + '><option value="">Mes</option>' + MONTHS.map((label, i) => '<option value="' + (i + 1) + '"' + (Number(month) === i + 1 ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
      '<label>Año<input aria-label="Año de nacimiento" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="AAAA" autocomplete="bday-year" data-birth-part="year"' + indexAttr + ' value="' + year + '"' + requiredAttr + '></label>' +
      '</div><input type="hidden" id="' + id + '"' + hiddenName + ' data-birth-value' + indexAttr + ' value="' + (birthISO(day, month, year) || '') + '"></div>';
  }

  function update(group) {
    if (!group) return '';
    const day = group.querySelector('[data-birth-part="day"]');
    const month = group.querySelector('[data-birth-part="month"]');
    const year = group.querySelector('[data-birth-part="year"]');
    const hidden = group.querySelector('[data-birth-value]');
    if (!day || !month || !year || !hidden) return '';
    const iso = birthISO(day.value, month.value, year.value);
    const complete = Boolean(day.value && month.value && year.value);
    const days = Number(month.value) && /^\d{4}$/.test(year.value) ? new Date(Date.UTC(Number(year.value), Number(month.value), 0)).getUTCDate() : 31;
    day.max = String(days);
    const message = complete && !iso ? 'Ingresa una fecha real, anterior a hoy y desde 1900.' : '';
    day.setCustomValidity(message);
    month.setCustomValidity(message);
    year.setCustomValidity(message);
    hidden.value = iso;
    return iso;
  }

  function setValue(group, iso = '') {
    if (!group) return;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
    const values = match ? { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) } : { year: '', month: '', day: '' };
    for (const part of ['day', 'month', 'year']) {
      const input = group.querySelector('[data-birth-part="' + part + '"]');
      if (input) input.value = values[part];
    }
    update(group);
  }

  root.KineticHubBirthDate = { birthISO, markup, update, setValue };
})(typeof window !== 'undefined' ? window : globalThis);
