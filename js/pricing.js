'use strict';
(function () {
  var isAnnual = false;

  var toggle = document.getElementById('billingToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      isAnnual = !isAnnual;
      toggle.classList.toggle('active', isAnnual);

      document.getElementById('basicPrice').textContent = isAnnual ? '399' : '499';
      document.getElementById('basicPeriod').textContent = isAnnual ? 'شهرياً (عند الدفع سنوياً)' : 'شهرياً';
      document.getElementById('basicAnnual').classList.toggle('show', isAnnual);

      document.getElementById('advPrice').textContent = isAnnual ? '799' : '999';
      document.getElementById('advPeriod').textContent = isAnnual ? 'شهرياً (عند الدفع سنوياً)' : 'شهرياً';
      document.getElementById('advAnnual').classList.toggle('show', isAnnual);
    });
  }

  document.querySelectorAll('.faq-q').forEach(function (el) {
    el.addEventListener('click', function () {
      var item = el.parentElement;
      var isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(function (i) { i.classList.remove('open'); });
      if (!isOpen) item.classList.add('open');
    });
  });
})();
