/* Shad app landing - behaviour.
 * Works without this file: every section is readable, nothing starts hidden.
 * With it: language switch, the journey stage, the permissions demo, copy
 * buttons, and - only when the visitor has not asked for reduced motion - the
 * particle scene, smooth scroll and scroll choreography. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ settings */
  // Paste the store links here when they are ready. Empty = button shows as
  // unavailable with a "coming soon" note.
  var STORE_LINKS = {
    play: '',
    apple: ''
  };

  var root = document.documentElement;
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOTION = !RM;
  if (MOTION) root.classList.add('motion');

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var cssVar = function (name, el) { return getComputedStyle(el || root).getPropertyValue(name).trim(); };

  /* ------------------------------------------------------------ language */
  var TITLES = {
    ar: 'تطبيق شاد | مشروعك كله في نقطة واحدة',
    en: 'The Shad app | Your whole project, in one dot'
  };
  var DESCS = {
    ar: 'العقد والتوقيع والدفع والمحادثة والاجتماعات والملفات. كل ما بينك وبين فريق شاد في مكان واحد، على الويب والموبايل.',
    en: 'Contract, signature, payment, chat, meetings and files. Everything between you and the Shad team in one place, on web and mobile.'
  };
  var lang = root.dataset.l === 'en' ? 'en' : 'ar';
  var langListeners = [];

  function applyLang(l) {
    lang = l;
    root.lang = l;
    root.dir = l === 'ar' ? 'rtl' : 'ltr';
    root.dataset.l = l;
    document.title = TITLES[l];
    var d = $('meta[name="description"]');
    if (d) d.setAttribute('content', DESCS[l]);
    $$('[data-ar-label]').forEach(function (el) {
      el.setAttribute('aria-label', el.getAttribute(l === 'ar' ? 'data-ar-label' : 'data-en-label'));
    });
    try { localStorage.setItem('shad-app-lang', l); } catch (e) { /* private mode */ }
    langListeners.forEach(function (fn) { fn(l); });
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }
  var langBtn = $('#lang');
  if (langBtn) langBtn.addEventListener('click', function () { applyLang(lang === 'ar' ? 'en' : 'ar'); });
  applyLang(lang);

  // Text of a bilingual node in the current language.
  function textIn(el) {
    var span = el.querySelector('.' + lang);
    return (span || el).textContent.trim();
  }

  /* ------------------------------------------------------------ store links */
  $$('[data-store]').forEach(function (a) {
    var url = STORE_LINKS[a.dataset.store];
    if (url) {
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
    } else {
      a.removeAttribute('href');
      a.setAttribute('role', 'link');
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('aria-describedby', 'stores-note');
    }
  });
  var storesNote = $('#stores-note');
  if (storesNote && STORE_LINKS.play && STORE_LINKS.apple) storesNote.hidden = true;

  /* ------------------------------------------------------------ copy e-mail */
  var copyStatus = $('#copy-status');
  $$('.copy').forEach(function (btn) {
    var timer;
    btn.addEventListener('click', function () {
      var value = btn.dataset.copy;
      var done = function () {
        btn.classList.add('is-done');
        if (copyStatus) copyStatus.textContent = lang === 'ar' ? 'تم نسخ ' + value : value + ' copied';
        clearTimeout(timer);
        timer = setTimeout(function () { btn.classList.remove('is-done'); }, 2200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, function () { fallbackCopy(value); done(); });
      } else { fallbackCopy(value); done(); }
    });
  });
  function fallbackCopy(value) {
    var t = document.createElement('textarea');
    t.value = value; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    t.remove();
  }

  /* ------------------------------------------------------------ permissions demo */
  function renderPerm(row) {
    var on = $$('.chip[aria-pressed="true"]', row).map(textIn);
    var sum = $('.perm__sum', row);
    if (!sum) return;
    if (!on.length) {
      sum.textContent = lang === 'ar' ? 'لا يرى شيئًا الآن. اختر صلاحية واحدة على الأقل.' : 'Sees nothing yet. Pick at least one permission.';
    } else {
      sum.textContent = (lang === 'ar' ? 'يرى: ' : 'Sees: ') + on.join(lang === 'ar' ? '، ' : ', ');
    }
  }
  $$('[data-person]').forEach(function (row) {
    $$('.chip', row).forEach(function (chip) {
      chip.addEventListener('click', function () {
        chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        renderPerm(row);
      });
    });
    renderPerm(row);
  });
  langListeners.push(function () { $$('[data-person]').forEach(renderPerm); });

  /* ------------------------------------------------------------ journey stage */
  var steps = $$('.step');
  var frags = $$('.frag');
  var activeStep = -1;
  function setStep(i) {
    if (i === activeStep) return;
    activeStep = i;
    steps.forEach(function (s, n) { s.classList.toggle('is-active', n === i); });
    frags.forEach(function (f, n) { f.classList.toggle('is-active', n === i); });
    if (i === 2 && MOTION) drawInk();
  }
  function drawInk() {
    var ink = $('.frag--sign .ink');
    if (!ink) return;
    var start = null, dur = 1400;
    ink.style.setProperty('--ink', '1');
    function tick(t) {
      if (start === null) start = t;
      var k = clamp((t - start) / dur, 0, 1);
      ink.style.setProperty('--ink', String(1 - (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if (steps.length && 'IntersectionObserver' in window) {
    var stepIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setStep(steps.indexOf(e.target));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { stepIO.observe(s); });
  }
  setStep(0);

  /* ------------------------------------------------------------ header state */
  var bar = $('#top-bar');
  var navLinks = $$('.top__nav a');
  var team = $('#team');
  function headerState() {
    if (!bar) return;
    var h = bar.offsetHeight;
    var t = team ? team.getBoundingClientRect() : null;
    var overLight = t && t.top < h && t.bottom > h;
    if (overLight) bar.setAttribute('data-theme', 'light'); else bar.removeAttribute('data-theme');
    var mid = window.innerHeight * 0.4;
    navLinks.forEach(function (a) {
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      var r = sec && sec.getBoundingClientRect();
      var on = !!r && r.top <= mid && r.bottom > mid;
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', headerState, { passive: true });
  window.addEventListener('resize', headerState);
  headerState();

  /* ------------------------------------------------------------ statement words */
  function splitWords(el) {
    $$('.ar, .en', el).forEach(function (span) {
      var words = span.textContent.split(/(\s+)/);
      span.textContent = '';
      words.forEach(function (w) {
        if (/^\s+$/.test(w)) { span.appendChild(document.createTextNode(w)); return; }
        if (!w) return;
        var s = document.createElement('span');
        s.className = 'w';
        s.textContent = w;
        span.appendChild(s);
      });
    });
  }
  $$('[data-words]').forEach(splitWords);

  if (!MOTION) {
    $$('.statement .w').forEach(function (w) { w.classList.add('is-lit'); });
    initParticles(true); // one still frame of the field, behind the hero only
    return; // reduced motion: everything above is all the page needs
  }

  /* ============================================================ motion only */
  var hasGsap = !!(window.gsap && window.ScrollTrigger);
  var lenis = null;

  if (window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, anchors: { offset: -80 }, autoRaf: !hasGsap });
  }
  if (hasGsap) {
    var gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);
    if (lenis) {
      lenis.on('scroll', window.ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    }

    // statement lights up word by word
    $$('.statement').forEach(function (st) {
      window.ScrollTrigger.create({
        trigger: st, start: 'top 80%', end: 'bottom 45%', scrub: true,
        onUpdate: function (self) {
          var words = $$('.' + lang + ' .w', st);
          var lit = Math.round(self.progress * words.length);
          words.forEach(function (w, i) { w.classList.toggle('is-lit', i < lit); });
        }
      });
    });

    // noise chips get pulled toward the centre and dissolve
    $$('.nchip').forEach(function (chip, i) {
      gsap.to(chip, {
        xPercent: (i % 2 ? -1 : 1) * 60, yPercent: 160 + i * 20, scale: 0.6, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 30%', scrub: true }
      });
    });

    // gentle float before scrolling
    $$('.nchip').forEach(function (chip, i) {
      gsap.to(chip, { y: (i % 2 ? 1 : -1) * 10, duration: 3 + i * 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    });

    // the dot opens into the light section
    var iris = $('.iris');
    if (iris) {
      var lightPage = cssVar('--color-surface-page', team || root);
      gsap.fromTo(iris, { scale: 1 }, {
        scale: function () {
          var d = iris.offsetWidth || 14;
          return Math.hypot(window.innerWidth, window.innerHeight) / d * 1.08;
        },
        backgroundColor: lightPage,
        ease: 'power2.in',
        scrollTrigger: { trigger: '.iris-gap', start: 'top 75%', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true }
      });
    }

    // the phone drifts against the scroll
    var phone = $('.phone');
    if (phone) {
      gsap.fromTo(phone, { y: 60, rotate: -2 }, {
        y: -40, rotate: 1, ease: 'none',
        scrollTrigger: { trigger: '.app', start: 'top bottom', end: 'bottom top', scrub: true }
      });
    }

    // the idea dot breathes in as it arrives
    var bigDot = $('#big-dot');
    if (bigDot) {
      gsap.fromTo(bigDot, { scale: 0.35 }, {
        scale: 1, ease: 'none',
        scrollTrigger: { trigger: '#idea', start: 'top bottom', end: 'center center', scrub: true }
      });
    }

    window.addEventListener('load', function () { window.ScrollTrigger.refresh(); });
  }

  /* ------------------------------------------------------------ particles */
  initParticles(false);

  function initParticles(still) {
    var canvas = $('#stage');
    if (!canvas || !window.THREE) return;
    var THREE = window.THREE;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    if (!renderer.getContext()) return;
    root.classList.add('gl');

    var W = window.innerWidth, H = window.innerHeight;
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var small = W < 768;
    var COUNT = still ? 1800 : (small ? 2600 : 6500);

    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H, false);
    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -10, 10);

    // sample the "d." mark
    var markPts = sampleMark(COUNT);

    var geo = new THREE.BufferGeometry();
    var aNoise = new Float32Array(COUNT * 2);
    var aMark = new Float32Array(COUNT * 2);
    var aDisk = new Float32Array(COUNT * 2);
    var aSeed = new Float32Array(COUNT);
    var aRed = new Float32Array(COUNT);
    var aSize = new Float32Array(COUNT);
    for (var i = 0; i < COUNT; i++) {
      aNoise[i * 2] = Math.random() * 2.2 - 1.1;
      aNoise[i * 2 + 1] = Math.random() * 2.2 - 1.1;
      var m = markPts[i % markPts.length];
      aMark[i * 2] = m[0] + (Math.random() - 0.5) * 0.012;
      aMark[i * 2 + 1] = m[1] + (Math.random() - 0.5) * 0.012;
      var r = Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
      aDisk[i * 2] = Math.cos(th) * r;
      aDisk[i * 2 + 1] = Math.sin(th) * r;
      aSeed[i] = Math.random();
      aRed[i] = m[2] ? 1 : (Math.random() < 0.05 ? 1 : 0);
      aSize[i] = 0.6 + Math.pow(Math.random(), 3) * 2.4;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('aNoise', new THREE.BufferAttribute(aNoise, 2));
    geo.setAttribute('aMark', new THREE.BufferAttribute(aMark, 2));
    geo.setAttribute('aDisk', new THREE.BufferAttribute(aDisk, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute('aRed', new THREE.BufferAttribute(aRed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

    var soft = new THREE.Color(cssVar('--color-text-primary'));
    var crimson = new THREE.Color(cssVar('--color-accent-dot'));
    crimson.offsetHSL(0, 0.05, 0.12);

    var uniforms = {
      uTime: { value: 0 },
      uView: { value: new THREE.Vector2(W / 2, H / 2) },
      uMarkC: { value: new THREE.Vector2(0, 0) },
      uMarkS: { value: 1 },
      uDot: { value: new THREE.Vector2(0, -H) },
      uDotR: { value: 30 },
      uA: { value: 0 },
      uB: { value: 0 },
      uIntro: { value: 0 },
      uAlpha: { value: 1 },
      uPointer: { value: new THREE.Vector2(9999, 9999) },
      uPx: { value: DPR },
      uSoft: { value: soft },
      uRed: { value: crimson }
    };

    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        'attribute vec2 aNoise; attribute vec2 aMark; attribute vec2 aDisk;',
        'attribute float aSeed; attribute float aRed; attribute float aSize;',
        'uniform float uTime, uMarkS, uDotR, uA, uB, uIntro, uPx;',
        'uniform vec2 uView, uMarkC, uDot, uPointer;',
        'varying float vRed; varying float vFade;',
        'float ease(float t){ t = clamp(t,0.0,1.0); return t*t*(3.0-2.0*t); }',
        'void main(){',
        '  float s = aSeed * 6.2831;',
        '  vec2 n = aNoise * uView;',
        '  n += vec2(sin(uTime*0.21 + s*3.0), cos(uTime*0.17 + s*2.0)) * (18.0 + aSeed*30.0);',
        '  n *= mix(1.35, 1.0, ease(uIntro));',
        '  float ea = ease(uA * 1.5 - aSeed * 0.5);',
        '  vec2 mk = uMarkC + aMark * uMarkS;',
        '  mk += vec2(sin(uTime*0.9 + s), cos(uTime*0.8 + s)) * 1.5;',
        '  vec2 p = mix(n, mk, ea);',
        '  float eb = ease(uB * 1.5 - aSeed * 0.5);',
        '  vec2 dp = uDot + aDisk * uDotR;',
        '  p = mix(p, dp, eb);',
        '  vec2 d = p - uPointer; float dl = length(d);',
        '  float push = exp(-(dl*dl) / 9000.0) * (1.0 - eb) * 46.0;',
        '  p += (dl > 0.001 ? d / dl : vec2(0.0)) * push;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);',
        '  float tw = 0.65 + 0.35 * sin(uTime * (1.0 + aSeed * 2.0) + s);',
        '  gl_PointSize = aSize * uPx * mix(1.6, 1.15, ea) * mix(1.0, 0.7, eb) * (0.85 + 0.3 * tw);',
        '  vRed = aRed; vFade = tw * mix(0.55, 0.95, ea);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uSoft, uRed; uniform float uAlpha;',
        'varying float vRed; varying float vFade;',
        'void main(){',
        '  vec2 c = gl_PointCoord - 0.5; float d = length(c);',
        '  float a = smoothstep(0.5, 0.0, d);',
        '  vec3 col = mix(uSoft, uRed, vRed);',
        '  gl_FragColor = vec4(col, a * vFade * uAlpha * mix(0.75, 1.0, vRed));',
        '}'
      ].join('\n')
    });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);

    // layout: where the mark sits and where the dot is
    var hero = $('.hero'), idea = $('#idea'), bigDot = $('#big-dot');
    function layout() {
      W = window.innerWidth; H = window.innerHeight; small = W < 768;
      renderer.setSize(W, H, false);
      camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2;
      camera.updateProjectionMatrix();
      uniforms.uView.value.set(W / 2, H / 2);
      var markH = small ? H * 0.3 : Math.min(H * 0.64, W * 0.36);
      uniforms.uMarkS.value = markH / 2;
      var side = lang === 'ar' ? -1 : 1; // text sits on the start side, the mark on the end side
      if (small) uniforms.uMarkC.value.set(0, H * 0.22);
      else uniforms.uMarkC.value.set(side * W * 0.27, H * 0.02);
    }
    langListeners.push(layout);
    window.addEventListener('resize', layout);
    layout();

    if (still) {
      uniforms.uIntro.value = 1;
      var paint = function () { layout(); renderer.render(scene, camera); };
      window.addEventListener('resize', paint);
      paint();
      return;
    }

    window.addEventListener('pointermove', function (e) {
      uniforms.uPointer.value.set(e.clientX - W / 2, H / 2 - e.clientY);
    }, { passive: true });
    window.addEventListener('pointerleave', function () { uniforms.uPointer.value.set(9999, 9999); });

    var t0 = performance.now();
    var running = true;
    document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) requestAnimationFrame(frame); });

    function frame(now) {
      if (!running) return;
      var t = (now - t0) / 1000;
      uniforms.uTime.value = t;
      uniforms.uIntro.value = clamp(t / 2.2, 0, 1);

      var y = window.scrollY;
      var heroH = hero ? hero.offsetHeight : H;
      uniforms.uA.value = clamp((y / (heroH * 0.75)) * 1.0 + Math.min(t / 6, 0.12), 0, 1);

      var bA = 0, alpha = 1;
      if (idea && bigDot) {
        var ir = idea.getBoundingClientRect();
        var dr = bigDot.getBoundingClientRect();
        var dotY = dr.top + dr.height / 2;
        // 0 while the dot is below the fold, 1 once it reaches the middle
        bA = ir.top > H * 1.5 ? 0 : clamp((H * 1.05 - dotY) / (H * 0.55), 0, 1);
        uniforms.uDot.value.set(dr.left + dr.width / 2 - W / 2, H / 2 - dotY);
        uniforms.uDotR.value = dr.width * 0.42;
        // fade out once the dot has landed and the section scrolls on
        alpha = 1 - clamp((H * 0.5 - dotY) / (H * 0.35), 0, 1);
      }
      uniforms.uB.value = bA;
      uniforms.uAlpha.value = alpha;
      canvas.style.opacity = alpha <= 0.001 ? '0' : '1';
      if (alpha > 0.001) renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Points inside the "d." mark, normalised to [-1, 1] on the long side, y up.
  // Third value flags the dot so it can glow crimson.
  function sampleMark(want) {
    var tpl = document.querySelector('#mark path');
    var out = [];
    if (!tpl || !window.Path2D) {
      for (var k = 0; k < 400; k++) out.push([Math.random() - 0.5, Math.random() - 0.5, 0]);
      return out;
    }
    var VW = 330, VH = 516, S = 0.5;
    var c = document.createElement('canvas');
    c.width = Math.round(VW * S); c.height = Math.round(VH * S);
    var ctx = c.getContext('2d');
    ctx.scale(S, S);
    ctx.translate(-375, -282);
    ctx.fill(new Path2D(tpl.getAttribute('d')), 'evenodd');
    var data = ctx.getImageData(0, 0, c.width, c.height).data;
    var pts = [];
    for (var y = 0; y < c.height; y++) {
      for (var x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 128) {
          var sx = x / S + 375, sy = y / S + 282;
          var isDot = sx > 615 && sy > 700;
          pts.push([((x / c.width) - 0.5) * (VW / VH) * 2, (0.5 - (y / c.height)) * 2, isDot ? 1 : 0]);
        }
      }
    }
    for (var i = pts.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp; }
    return pts.length > want ? pts.slice(0, want) : pts;
  }
})();
