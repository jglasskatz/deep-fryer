/**
 * deep-fryer embed loader (SPEC.md §10, protocol unchanged from v0).
 *
 * Usage on a customer site:
 *   <div data-deep-fryer="TENANT_SLUG"></div>
 *   <script async src="https://app.deep-fryer.io/embed.js"></script>
 *
 * Optional data-lang="es" (or zh-hant, zh-hans, ru, bn, ht, ko, ar, ur, fr,
 * pl) shows the embed in that language — e.g. on a city's Spanish pages.
 *
 * Creates the iframe, passes the page origin for the allowlist check, and
 * resizes the frame from the embed's postMessage events.
 */
(function () {
  var HOST = (function () {
    var script = document.currentScript;
    if (script && script.src) {
      var a = document.createElement('a');
      a.href = script.src;
      return a.protocol + '//' + a.host;
    }
    return 'https://app.deep-fryer.io';
  })();

  // Keep in sync with apps/web/lib/i18n/locales.ts (checked by embed-loader.test.ts).
  var LANGS = ['es', 'zh-hant', 'zh-hans', 'ru', 'bn', 'ht', 'ko', 'ar', 'ur', 'fr', 'pl'];

  function mount(el) {
    var slug = el.getAttribute('data-deep-fryer');
    if (!slug || el.getAttribute('data-df-mounted')) return;
    el.setAttribute('data-df-mounted', '1');

    var lang = (el.getAttribute('data-lang') || '').toLowerCase();
    var prefix = LANGS.indexOf(lang) === -1 ? '' : '/' + lang;

    var iframe = document.createElement('iframe');
    iframe.src =
      HOST + prefix + '/embed/' + encodeURIComponent(slug) +
      '?origin=' + encodeURIComponent(window.location.origin);
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.minHeight = '480px';
    iframe.setAttribute('title', 'Doughnut portrait');
    iframe.setAttribute('loading', 'lazy');
    el.appendChild(iframe);

    window.addEventListener('message', function (event) {
      if (event.origin !== HOST) return;
      var data = event.data;
      if (data && data.type === 'deep-fryer:resize' && data.tenant === slug) {
        iframe.style.height = data.height + 'px';
      }
    });
  }

  function init() {
    var els = document.querySelectorAll('[data-deep-fryer]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
