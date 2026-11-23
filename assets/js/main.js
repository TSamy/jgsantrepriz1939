/* =========================================================
   JGS Antrepriz 1939 — main script (vanilla JS, no deps)
   Modules: header state · mobile nav · active section ·
            hero video · contacts (phone/WhatsApp) · floating WhatsApp ·
            copy email · reveal · year
   Editable values (phones, WhatsApp, poster) live in assets/js/config.js.
   Every module is optional: the page works without JS.
   ========================================================= */
(function () {
  'use strict';

  var CONFIG = window.JGS_CONFIG || {};
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopNav = window.matchMedia('(min-width: 960px)');

  /* ---------- Header: opaque background after scrolling ---------- */
  function initHeader() {
    var header = document.querySelector('[data-header]');
    if (!header) return;
    var ticking = false;
    function update() {
      header.classList.toggle('is-scrolled', window.scrollY > 24);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ---------- Mobile navigation (accessible disclosure + modal behaviour) ---------- */
  function initNav() {
    var header = document.querySelector('[data-header]');
    var toggle = document.querySelector('[data-nav-toggle]');
    var nav = document.querySelector('[data-nav]');
    if (!header || !toggle || !nav) return;

    var label = toggle.querySelector('.nav-toggle__label');
    var outside = [document.getElementById('main'), document.querySelector('.site-footer'),
                   document.querySelector('.skip-link'), document.querySelector('[data-wa-fab]')];

    function setOutsideInert(on) {
      outside.forEach(function (el) {
        if (!el) return;
        if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
      });
    }

    function open() {
      header.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      if (label) label.textContent = 'Close';
      document.body.classList.add('nav-locked');
      setOutsideInert(true);
      var first = nav.querySelector('a');
      if (first) first.focus();
    }

    function close(returnFocus) {
      if (!header.classList.contains('is-open')) return;
      header.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      if (label) label.textContent = 'Menu';
      document.body.classList.remove('nav-locked');
      setOutsideInert(false);
      if (returnFocus) toggle.focus();
    }

    toggle.setAttribute('aria-label', 'Open menu');
    toggle.addEventListener('click', function () {
      if (header.classList.contains('is-open')) close(true); else open();
    });

    // Close after choosing a destination
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) close(false);
    });

    // Escape closes; Tab is kept inside the header while the menu is open
    document.addEventListener('keydown', function (e) {
      if (!header.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key !== 'Tab') return;
      var focusable = Array.prototype.filter.call(
        header.querySelectorAll('a[href], button:not([hidden])'),
        function (el) { return el.offsetParent !== null; }
      );
      if (!focusable.length) return;
      var firstEl = focusable[0];
      var lastEl = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    });

    // Switching to the desktop layout always resets the menu
    var onBreakpoint = function (mq) { if (mq.matches) close(false); };
    if (desktopNav.addEventListener) desktopNav.addEventListener('change', onBreakpoint);
    else if (desktopNav.addListener) desktopNav.addListener(onBreakpoint);
  }

  /* ---------- Highlight the section currently in view ---------- */
  function initActiveSection() {
    if (!('IntersectionObserver' in window)) return;
    var links = document.querySelectorAll('.site-nav__list a[href^="#"]');
    var map = {};
    Array.prototype.forEach.call(links, function (a) {
      var id = a.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      if (section) map[id] = { link: a, section: section };
    });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Object.keys(map).forEach(function (id) { map[id].link.removeAttribute('aria-current'); });
        var hit = map[entry.target.id];
        if (hit) hit.link.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { observer.observe(map[id].section); });
  }

  /* ---------- Hero background video ----------
     Behaviour:
     - Does nothing until data-enabled="true" (no requests, gradient fallback).
     - Portrait screens (phones, upright tablets) get data-src-portrait;
       landscape screens (desktops, rotated phones) get data-src-landscape.
       Both keep the source aspect ratio; CSS object-fit: cover crops, never stretches.
     - Reduced motion, Save-Data, 2G or 3G connection: no video download;
       poster (if configured) or gradient, and the visitor may start it with the button.
     - Stall guard: if an automatic start has not begun playing within
       STALL_MS (very slow network, or a browser that does not report the
       connection, e.g. iOS Safari), the download is aborted and the
       "Play" button is offered instead. A visitor-initiated play is never aborted.
     - Poster: CONFIG.heroPoster, applied only once the image has actually loaded
       (a missing file never shows a broken image).
     - Loads after the page's main content (window load) to protect first paint.
     - Pauses when off-screen or tab hidden (battery), resumes unless user paused.
     - Any error: video removed, gradient fallback stays. */
  function initHeroVideo() {
    var video = document.querySelector('[data-hero-video]');
    var button = document.querySelector('[data-video-toggle]');
    if (!video || video.dataset.enabled !== 'true') return;

    var labelEl = button && button.querySelector('[data-video-toggle-label]');
    var userPaused = false;
    var inView = true;
    var loaded = false;
    var failed = false;
    var STALL_MS = 8000;
    var stallTimer = null;

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var constrained = !!(conn && (conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')));

    // Company-supplied poster: shown as soon as it has loaded (also when autoplay
    // is skipped). Without one, the gradient stays until the video is playing.
    if (CONFIG.heroPoster) {
      var probe = new Image();
      probe.onload = function () {
        if (failed) return;
        video.poster = CONFIG.heroPoster;
        video.classList.add('is-ready');
      };
      probe.onerror = function () {
        if (window.console) console.warn('Hero poster not found: ' + CONFIG.heroPoster);
      };
      probe.src = CONFIG.heroPoster;
    }

    function setButton(paused) {
      if (!button || failed) return;
      button.hidden = false;
      button.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (labelEl) labelEl.textContent = paused ? 'Play background video' : 'Pause background video';
    }

    function fail() {
      failed = true;
      if (video.parentNode) video.parentNode.removeChild(video);
      if (button) button.hidden = true;
    }

    function load() {
      if (loaded) return;
      loaded = true;
      var portrait = window.matchMedia('(max-aspect-ratio: 1/1)').matches;
      var d = video.dataset;
      var src = portrait ? (d.srcPortrait || d.srcLandscape) : (d.srcLandscape || d.srcPortrait);
      if (!src) { fail(); return; }
      var source = document.createElement('source');
      source.src = src;
      source.type = 'video/mp4';
      source.addEventListener('error', fail);
      video.appendChild(source);
      video.preload = 'auto';
      video.load();
    }

    function abortSlowStart() {
      stallTimer = null;
      if (failed || (!video.paused && video.currentTime > 0)) return;
      constrained = true;               // no further automatic attempts on this visit
      video.pause();
      while (video.firstChild) video.removeChild(video.firstChild);
      video.removeAttribute('src');
      video.load();                     // cancels the pending download
      loaded = false;
      setButton(true);
    }

    function play(auto) {
      if (failed) return;
      load();
      if (auto && !stallTimer) stallTimer = setTimeout(abortSlowStart, STALL_MS);
      var p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () { setButton(true); }); // autoplay blocked: offer manual play
      }
    }

    video.addEventListener('playing', function () {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      video.classList.add('is-ready');
      setButton(false);
    });
    video.addEventListener('error', fail);

    if (button) {
      button.addEventListener('click', function () {
        if (video.paused) { userPaused = false; play(); }
        else { userPaused = true; video.pause(); setButton(true); }
      });
    }

    function shouldAutoplay() {
      return !reducedMotion.matches && !constrained && !userPaused;
    }

    function start() {
      if (shouldAutoplay()) play(true);
      else setButton(true); // poster only; the visitor chooses to play
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    // Respect a preference change while on the page
    var onMotion = function (mq) {
      if (mq.matches && !video.paused) { userPaused = true; video.pause(); setButton(true); }
    };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotion);
    else if (reducedMotion.addListener) reducedMotion.addListener(onMotion);

    // Save battery/data: pause when not visible, resume if the visitor had not paused it
    function syncVisibility() {
      if (!loaded || failed) return;
      var visible = inView && document.visibilityState === 'visible';
      if (!visible && !video.paused) video.pause();
      else if (visible && video.paused && shouldAutoplay()) video.play().catch(function () {});
    }
    document.addEventListener('visibilitychange', syncVisibility);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        syncVisibility();
      }, { threshold: 0.05 }).observe(video.parentNode);
    }
  }

  /* ---------- Contacts: validate configured numbers ----------
     Returns only complete, well-formed numbers. Empty, partial or placeholder
     values (letters, wrong length, wrong country code) are rejected, so nothing
     fictitious or half-filled can ever be displayed. */
  function getContacts() {
    var list = Array.isArray(CONFIG.contacts) ? CONFIG.contacts : [];
    var message = CONFIG.whatsappMessage || '';
    return list.map(function (c) {
      var raw = String(c.phone || '').trim();
      if (!raw || raw.charAt(0) !== '+' || /[^\d\s+().-]/.test(raw)) return null;
      var digits = raw.replace(/\D/g, '');
      var cc = String(c.countryCode || '');
      if (!cc || digits.indexOf(cc) !== 0 || digits.length !== cc.length + Number(c.digits)) return null;
      return {
        id: c.id,
        label: c.label,
        display: raw,
        tel: 'tel:+' + digits,
        whatsapp: c.whatsapp
          ? 'https://wa.me/' + digits + (message ? '?text=' + encodeURIComponent(message) : '')
          : null
      };
    }).filter(Boolean);
  }

  /* ---------- Contact section: Haiti Office / USA Contact blocks ---------- */
  function initContacts(contacts) {
    var wrap = document.querySelector('[data-offices]');
    if (!wrap) return;
    var shown = 0, anyWhatsApp = false;
    contacts.forEach(function (c) {
      var card = wrap.querySelector('[data-contact="' + c.id + '"]');
      if (!card) return;
      var label = card.querySelector('[data-contact-label]');
      var number = card.querySelector('[data-contact-number]');
      var call = card.querySelector('[data-contact-call]');
      var wa = card.querySelector('[data-contact-whatsapp]');
      if (label && c.label) label.textContent = c.label;
      if (number) number.textContent = c.display;
      if (call) {
        call.href = c.tel;
        call.setAttribute('aria-label', 'Call Now: ' + c.label + ', ' + c.display);
      }
      if (wa) {
        if (c.whatsapp) {
          wa.href = c.whatsapp;
          wa.setAttribute('aria-label', 'WhatsApp: ' + c.label + ' (opens WhatsApp in a new tab)');
          wa.hidden = false;
          anyWhatsApp = true;
        } else {
          wa.hidden = true;
        }
      }
      card.hidden = false;
      shown++;
    });
    if (!shown) return;
    wrap.hidden = false;
    var intro = document.querySelector('[data-contact-intro]');
    if (intro) {
      intro.textContent = 'For purchasing inquiries and commercial information, contact our team by email, phone' +
        (anyWhatsApp ? ' or WhatsApp.' : '.');
    }
  }

  /* ---------- Floating WhatsApp button ----------
     - Hidden when no WhatsApp number is configured.
     - One number: direct link. Several: disclosure button + list to choose.
     - WhatsApp only opens after a click; nothing happens on page load.
     - Tucked away while the hero is on screen (keeps hero controls clear). */
  function initWhatsAppFab(contacts) {
    var fab = document.querySelector('[data-wa-fab]');
    if (!fab) return;
    var items = contacts.filter(function (c) { return c.whatsapp; });
    if (!items.length) return;

    var toggle = fab.querySelector('[data-wa-toggle]');
    var direct = fab.querySelector('[data-wa-direct]');
    var panel = fab.querySelector('[data-wa-panel]');
    var list = fab.querySelector('[data-wa-list]');

    fab.hidden = false;
    document.body.classList.add('has-wa-fab');

    function closePanel(returnFocus) {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (returnFocus) toggle.focus();
    }

    if (items.length === 1) {
      direct.href = items[0].whatsapp;
      direct.setAttribute('aria-label', 'Chat on WhatsApp with ' + items[0].label + ' (opens WhatsApp in a new tab)');
      direct.hidden = false;
    } else {
      items.forEach(function (c) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = c.whatsapp;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('data-wa-option', c.id);
        a.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-whatsapp"/></svg>';
        var text = document.createElement('span');
        text.appendChild(document.createTextNode(c.label));
        var small = document.createElement('small');
        small.textContent = c.display;
        text.appendChild(small);
        var hint = document.createElement('span');
        hint.className = 'visually-hidden';
        hint.textContent = ' (opens WhatsApp in a new tab)';
        text.appendChild(hint);
        a.appendChild(text);
        li.appendChild(a);
        list.appendChild(li);
      });
      toggle.hidden = false;
      toggle.addEventListener('click', function () {
        if (panel.hidden) {
          panel.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
          var first = list.querySelector('a');
          if (first) first.focus();
        } else {
          closePanel(true);
        }
      });
      list.addEventListener('click', function (e) { if (e.target.closest('a')) closePanel(false); });
      fab.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); closePanel(true); }
      });
      document.addEventListener('click', function (e) { if (!fab.contains(e.target)) closePanel(false); });
      fab.addEventListener('focusout', function (e) {
        if (e.relatedTarget && !fab.contains(e.relatedTarget)) closePanel(false);
      });
    }

    // Shown only between the hero and the Contact section:
    // - away while any part of the hero is on screen (keeps the hero buttons,
    //   pause control and "Scroll to explore" clear);
    // - away while the Contact section is on screen (it already has Call /
    //   WhatsApp / email buttons, and this keeps them and the footer clear).
    var watched = [document.querySelector('.hero'), document.getElementById('contact')].filter(Boolean);
    if (!('IntersectionObserver' in window) || !watched.length) return; // stays visible
    var inView = new Map();
    fab.classList.add('is-away');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { inView.set(e.target, e.isIntersecting); });
      var away = watched.some(function (el) { return inView.get(el); });
      fab.classList.toggle('is-away', away);
      if (away) closePanel(false);
    });
    watched.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- Copy email to clipboard (helps webmail users) ---------- */
  function initCopy() {
    var status = document.querySelector('[data-copy-status]');
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
      if (!navigator.clipboard || !window.isSecureContext) return; // stays hidden
      btn.hidden = false;
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(btn.dataset.copy).then(function () {
          if (status) status.textContent = 'Email address copied to clipboard.';
        }, function () {
          if (status) status.textContent = 'Copy failed — please select the address above.';
        });
        if (status) setTimeout(function () { status.textContent = ''; }, 4000);
      });
    });
  }

  /* ---------- Gentle reveal on scroll ---------- */
  function initReveal() {
    if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
    var targets = document.querySelectorAll('.section .section-tag, .section .section-title, .section .prose, .product-art, .spec-list, .step, .contact-card');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    Array.prototype.forEach.call(targets, function (el) {
      // Only animate what starts below the fold, so nothing visible "pops"
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('reveal');
        io.observe(el);
      }
    });
  }

  function init() {
    initHeader();
    initNav();
    initActiveSection();
    initHeroVideo();
    var contacts = getContacts();
    initContacts(contacts);
    initWhatsAppFab(contacts);
    initCopy();
    initReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
