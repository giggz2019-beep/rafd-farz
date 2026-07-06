'use strict';
(function () {
  // Brand logo in navbar — fallback on load error
  var brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    function onBrandLogoError() {
      brandLogo.style.display = 'none';
      var fb = brandLogo.nextElementSibling;
      if (fb) fb.style.display = 'flex';
    }
    if (brandLogo.complete && brandLogo.naturalHeight === 0) onBrandLogoError();
    else brandLogo.addEventListener('error', onBrandLogoError);
  }

  // Footer logo — hide on load error
  var footerLogo = document.querySelector('.footer-brand img');
  if (footerLogo) {
    function onFooterLogoError() { footerLogo.style.display = 'none'; }
    if (footerLogo.complete && footerLogo.naturalHeight === 0) onFooterLogoError();
    else footerLogo.addEventListener('error', onFooterLogoError);
  }

  // Hamburger menu toggle
  var hamburger = document.getElementById('hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function () {
      var nav = document.querySelector('.nav-links');
      nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
      nav.style.flexDirection = 'column';
      nav.style.position = 'absolute';
      nav.style.top = '72px';
      nav.style.right = '0';
      nav.style.left = '0';
      nav.style.background = '#fff';
      nav.style.padding = '1rem 2rem';
      nav.style.borderBottom = '1px solid #e2e8f0';
      nav.style.zIndex = '999';
    });
  }

  // Navbar scroll shadow
  window.addEventListener('scroll', function () {
    var nb = document.getElementById('navbar');
    if (nb) nb.style.boxShadow = window.scrollY > 50 ? '0 4px 24px rgba(0,0,0,.08)' : 'none';
  });
})();
