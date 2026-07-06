document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.getElementById('hamburger');
  const nav = document.querySelector('.nav-links');
  if (!hamburger || !nav) return;

  const closeMenu = () => {
    nav.classList.remove('mobile-open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.textContent = '☰';
  };

  const openMenu = () => {
    nav.classList.add('mobile-open');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.textContent = '✕';
  };

  hamburger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (nav.classList.contains('mobile-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Node && !nav.contains(target) && !hamburger.contains(target)) {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });
});
