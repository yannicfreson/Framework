/* Framework — motion layer.
 *
 * Locomotive Scroll v5 (Lenis under the hood) owns scrolling, anchor jumps, the hero
 * parallax and the scroll velocity/progress readings. Reveals are triggered by a plain
 * IntersectionObserver so a section always resolves, even when an anchor jump skips it.
 *
 * Everything here is an enhancement: without it the page renders complete and static.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var header = document.querySelector('.site-header');
  var track = document.querySelector('.marquee__track');

  /* ---------- Mobile nav (always on, motion or not) ---------- */

  (function nav() {
    var toggle = document.querySelector('.nav-toggle');
    var menu = document.getElementById('site-nav');
    if (!toggle || !menu) return;

    function close() {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();

  if (!root.classList.contains('motion')) return;

  /* ---------- Reveals ---------- */

  // Longest child delay (~940ms) plus the longest transition (1000ms), rounded up.
  var REVEAL_SETTLE = 2100;

  function settle(el) {
    window.setTimeout(function () {
      el.classList.add('is-done');
    }, REVEAL_SETTLE);
  }

  function reveal(el) {
    if (el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    settle(el);
  }

  var roots = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var hero = document.querySelector('.hero.reveal');

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });

    roots.forEach(function (el) {
      if (el !== hero) io.observe(el);
    });
  } else {
    roots.forEach(reveal);
  }

  // The hero plays as a load sequence rather than a scroll trigger. Wait for the web
  // fonts so the masked lines do not reveal in a fallback face and then reflow.
  function startHero() {
    if (hero) reveal(hero);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(startHero);
    window.setTimeout(startHero, 1200);
  } else {
    startHero();
  }

  /* ---------- Locomotive Scroll ---------- */

  if (typeof window.LocomotiveScroll !== 'function') {
    root.classList.add('motion-ready');
    return;
  }

  var velocity = 0;

  var scroll = new window.LocomotiveScroll({
    lenisOptions: {
      lerp: 0.085,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      autoResize: true
    },
    scrollCallback: function (values) {
      velocity = values.velocity;

      if (header) {
        header.style.setProperty('--progress', String(values.progress || 0));
        header.classList.toggle('is-scrolled', values.scroll > 40);
      }
    }
  });

  root.classList.add('motion-ready');

  /* ---------- Marquee driven by scroll velocity ---------- */

  if (track) {
    var x = 0;
    var groupWidth = 0;
    var BASE = 0.55;   // idle drift, px per frame
    var BOOST = 0.9;   // how hard scrolling pushes the track
    var CLAMP = 26;    // ceiling on that push

    // The track wraps every group width, so it must stay at least one group wider
    // than the viewport or a gap opens at the right edge on wide screens.
    function fill() {
      if (!groupWidth) return;
      var groups = track.querySelectorAll('.marquee__group');
      var need = Math.max(2, Math.ceil(window.innerWidth / groupWidth) + 1);
      if (groups.length >= need) return;

      var frag = document.createDocumentFragment();
      for (var i = groups.length; i < need; i++) {
        frag.appendChild(groups[0].cloneNode(true));
      }
      track.appendChild(frag);
    }

    // Group width moves when the web font swaps in and when the viewport changes.
    function measure() {
      var first = track.querySelector('.marquee__group');
      if (!first) return;
      var w = first.getBoundingClientRect().width;
      if (!w || Math.abs(w - groupWidth) < 0.5) return;
      groupWidth = w;
      fill();
    }

    measure();
    window.addEventListener('resize', function () { measure(); fill(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(measure).observe(track.querySelector('.marquee__group'));
    }

    var tick = function () {
      var boost = Math.max(-CLAMP, Math.min(CLAMP, velocity * BOOST));

      x -= BASE + boost;
      velocity *= 0.9;

      if (groupWidth > 0) {
        // Keep x inside [-groupWidth, 0) so the track never exposes its left edge.
        x = ((x % groupWidth) - groupWidth) % groupWidth;
      }

      track.style.setProperty('--x', x.toFixed(2) + 'px');
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  }

  // Section heights change as reveals settle; let Locomotive re-measure.
  window.setTimeout(function () { scroll.resize(); }, REVEAL_SETTLE + 200);

  /* ---------- Hero sculpture: SVG first, WebGL on top ---------- */

  // The SVG in the markup is what paints immediately and what stands in when any of
  // this is unavailable. The rendered version, with its real cast shadows, is an
  // upgrade applied once the page is idle — three.js is far too heavy to block on.
  (function heroSculpture() {
    var holder = document.querySelector('.hero__figure-inner');
    if (!holder) return;

    // The `mark` composition is nine bars that only line up into the F from one angle;
    // from anywhere else it is a scatter of loose beams. So the sculpture demonstrates
    // itself: hold on the letter long enough to read it, turn until it is plainly nine
    // separate things with no letter anywhere in them, hold there, turn back. The letter
    // is gone within a fraction of a radian, but it takes about seventy degrees before
    // the bars read as a pile someone tipped out rather than a mark seen off-axis.
    //
    // The turn the mark is framed for is a property of the composition, declared once in
    // blocks.js. Read it from there rather than restating it: when this number lived at
    // the call site, the post generator drew the same mark at a different size.
    var TURN = (window.FrameworkBlocks && window.FrameworkBlocks.framingFor('mark').yawRange || [0, 1.25])[1];
    var HOLD_LOOSE = 1500;
    var HOLD_MARK = 2600;
    var TURN_MS = 2200;
    var CYCLE = HOLD_LOOSE + TURN_MS + HOLD_MARK + TURN_MS;

    function ease(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // The cycle opens on the pile and resolves into the letter — that way round, because
    // the interesting half is watching a heap of loose bars turn out to have been the
    // mark all along, and you only get that if the heap comes first. The mark then holds
    // longest, being the thing worth looking at, before it comes apart again.
    //
    // Returns 0 and TURN exactly during the holds, so the render loop can idle through
    // them instead of redrawing a frame that has not changed.
    function yawAt(elapsed) {
      var t = elapsed % CYCLE;
      if (t < HOLD_LOOSE) return TURN;

      t -= HOLD_LOOSE;
      if (t < TURN_MS) return TURN * (1 - ease(t / TURN_MS));

      t -= TURN_MS;
      if (t < HOLD_MARK) return 0;

      return TURN * ease((t - HOLD_MARK) / TURN_MS);
    }

    // The flat SVG is the resolved mark; the canvas opens on the scattered end of the
    // cycle. Show the SVG first and the hero flashes the letter and then snaps it apart,
    // which reads as a fault rather than a reveal. So the SVG is held back — styles.css
    // starts it at zero opacity whenever motion is on — and fades in only once we know
    // the canvas is not coming: no WebGL, save-data, the module failing, or five seconds
    // gone on a slow connection.
    var FALLBACK_AFTER = 5000;
    var fallback = document.querySelector('.hero__figure img');
    var rendering = false;

    function showFallback() {
      if (rendering || !fallback) return;
      fallback.classList.add('is-in');
    }

    var fallbackTimer = window.setTimeout(showFallback, FALLBACK_AFTER);

    function giveUp() {
      window.clearTimeout(fallbackTimer);
      showFallback();
    }

    var connection = navigator.connection;
    if (connection && connection.saveData) { giveUp(); return; }

    var idle = window.requestIdleCallback || function (fn) { return window.setTimeout(fn, 400); };

    idle(function () {
      import('/assets/blocks3d.js').then(function (blocks3d) {
        if (!blocks3d.supported()) { giveUp(); return; }

        var sculpture;
        try {
          sculpture = blocks3d.createSculpture({
            composition: 'mark',
            ratio: '1:1',
            theme: 'paper'
            // padding, yawRange and shadowRoom all come from the composition's own
            // framing, so the flat SVG and this canvas cannot drift apart.
          });
        } catch (e) {
          giveUp();
          return;
        }

        var image = holder.querySelector('img');
        var canvas = sculpture.canvas;
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label',
          image ? image.getAttribute('alt') : 'The Framework F, formed by nine blocks that only line up from this angle');

        var visible = true;
        var dirty = true;
        var yaw = yawAt(0);
        var since = 0;

        function measure() {
          var rect = holder.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          sculpture.setSize(rect.width, rect.height);
          dirty = true;
        }

        function frame(now) {
          if (visible) {
            if (!since) since = now;
            var next = yawAt(now - since);
            if (next !== yaw) { yaw = next; dirty = true; }

            if (dirty) {
              sculpture.setYaw(yaw);
              sculpture.render();
              dirty = false;
            }
          }
          window.requestAnimationFrame(frame);
        }

        // Claim the fallback before anything is on screen, so a five-second timer that is
        // about to fire does not put the resolved mark up underneath the sculpture.
        rendering = true;
        window.clearTimeout(fallbackTimer);

        // Paint the opening frame before fading in, or the panel shows an empty box for
        // as long as the first render takes.
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.opacity = '0';
        canvas.style.transition = 'opacity 600ms ease';

        holder.appendChild(canvas);
        measure();
        sculpture.setYaw(yaw);
        sculpture.render();
        dirty = false;

        window.requestAnimationFrame(function () {
          canvas.style.opacity = '1';
          window.setTimeout(function () {
            if (image && image.parentNode) image.parentNode.removeChild(image);
          }, 700);
        });

        window.addEventListener('resize', measure);
        if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(holder);

        if (typeof IntersectionObserver === 'function') {
          new IntersectionObserver(function (entries) {
            var showing = entries[0].isIntersecting;
            // Restart the cycle on the way back in, so the reveal plays from the top
            // rather than dropping you into whatever phase the clock reached off-screen.
            if (showing && !visible) since = 0;
            visible = showing;
          }).observe(holder);
        }

        window.requestAnimationFrame(frame);
      }).catch(giveUp);
    });
  })();
})();
