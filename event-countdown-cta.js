(function(root) {
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render({target,href,tone='gold',mode='race-start',label}) {
    return `<a class="race-cta race-cta--${tone === 'blue' ? 'blue' : 'gold'}" href="${escape(href)}" title="${escape(label)}" aria-label="${escape(label)}" data-countdown-mode="${escape(mode)}" data-countdown-target="${escape(target)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></svg><span><small>${escape(label)}</small><strong><span data-countdown-days>--</span>d <span data-countdown-time>--:--:--</span></strong><span data-countdown-status></span></span></a>`;
  }
  root.KineticHubCountdownCTA={render};
})(typeof globalThis!=='undefined'?globalThis:window);
