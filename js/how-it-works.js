'use strict';
(function () {
  document.querySelectorAll('.faq-q').forEach(function (el) {
    el.addEventListener('click', function () {
      el.parentElement.classList.toggle('open');
    });
  });
})();
