/* La ligne d'activité : une barre par jour, du premier au dernier commit.

   Dessine toute <figure class="activite" data-debut data-jours>. Les attributs
   sont écrits par activite.mjs ; ce fichier ne fait que rendre.

     data-debut  la date de la première barre, en AAAA-MM-JJ
     data-jours  le nombre de commits par jour, séparés par des virgules

   La largeur d'une barre se déduit de la place : au plus 24 px, au moins 3 px
   avec 2 px d'écart. En dessous, les barres se touchent et la ligne devient un
   dégradé. La longueur dit donc la durée : un dépôt de deux semaines fait une
   ligne courte, un dépôt de deux ans remplit la largeur.

   Le palier de couleur est une classe, a0 à a4 ; les couleurs vivent dans le CSS.
   Rien en mouvement réduit (pas d'allumage), rien en tactile (pas de survol).

   Aucune dépendance. Poser en fin de body, ou avec defer. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var HAUT = 12, MAX = 24, MIN = 3, ECART = 2;

  var doux = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tactile = window.matchMedia && window.matchMedia('(hover: none)').matches;

  /* Les paliers : 0 ; 1 ; 2 à 5 ; 6 à 11 ; 12 et plus. */
  function palier(n) {
    return n <= 0 ? 0 : n === 1 ? 1 : n <= 5 ? 2 : n <= 11 ? 3 : 4;
  }

  /* La date d'une barre, dans la langue de la page. */
  function dateDe(figure) {
    var lang = document.documentElement.lang || 'fr';
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    } catch (e) {
      fmt = null;
    }
    return function (t) {
      var d = new Date(t);
      if (!fmt) return d.toISOString().slice(0, 10);
      return fmt.format(d);
    };
  }

  function unite(figure, n) {
    var un = figure.getAttribute('data-un') || '1 commit';
    var plusieurs = figure.getAttribute('data-plusieurs') || '{n} commits';
    var aucun = figure.getAttribute('data-aucun') || 'aucun commit';
    if (n === 0) return aucun;
    if (n === 1) return un;
    return plusieurs.replace('{n}', n);
  }

  function monter(figure) {
    var brut = figure.getAttribute('data-jours');
    var depart = figure.getAttribute('data-debut');
    if (!brut || !depart) return;

    var jours = brut.split(',').map(function (s) { return parseInt(s, 10) || 0; });
    if (!jours.length) return;
    var d0 = depart.split('-').map(Number);
    var t0 = Date.UTC(d0[0], d0[1] - 1, d0[2]);
    var enTexte = dateDe(figure);

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('height', HAUT);
    var bulle = document.createElement('span');
    bulle.className = 'activite-bulle';
    bulle.hidden = true;
    bulle.setAttribute('aria-hidden', 'true');
    figure.appendChild(svg);
    figure.appendChild(bulle);

    var barres = [], pas = 0, ecart = ECART, longueur = 0;

    function dessiner() {
      var W = figure.clientWidth;
      if (!W) return;
      var n = jours.length;
      ecart = ECART;
      var w = Math.min(MAX, (W + ecart) / n - ecart);
      if (w < MIN) { ecart = 0; w = W / n; }
      pas = w + ecart;
      longueur = Math.min(W, n * pas - ecart);
      svg.setAttribute('width', longueur.toFixed(2));
      svg.setAttribute('viewBox', '0 0 ' + longueur.toFixed(2) + ' ' + HAUT);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      barres = [];
      var arrondi = ecart ? Math.min(2, w / 2) : 0;
      /* sans écart, un chevauchement de 0,3 px évite les fils clairs entre deux barres */
      var large = ecart ? w : w + 0.3;
      for (var i = 0; i < n; i++) {
        var barre = document.createElementNS(NS, 'rect');
        barre.setAttribute('x', (i * pas).toFixed(2));
        barre.setAttribute('y', '0');
        barre.setAttribute('width', large.toFixed(2));
        barre.setAttribute('height', HAUT);
        if (arrondi) barre.setAttribute('rx', arrondi.toFixed(2));
        barre.setAttribute('class', 'a' + palier(jours[i]));
        svg.appendChild(barre);
        barres.push(barre);
      }
    }

    dessiner();

    if (window.ResizeObserver) {
      var cadre = 0;
      new ResizeObserver(function () {
        if (!cadre) cadre = window.requestAnimationFrame(function () { cadre = 0; dessiner(); });
      }).observe(figure);
    } else {
      window.addEventListener('resize', dessiner);
    }

    /* L'allumage de gauche à droite, à l'entrée dans l'écran. */
    if (doux || !('IntersectionObserver' in window)) {
      figure.classList.add('est-allumee');
    } else {
      var guetteur = new IntersectionObserver(function (entrees) {
        if (!entrees.some(function (e) { return e.isIntersecting; })) return;
        figure.classList.add('est-allumee');
        guetteur.disconnect();
      }, { threshold: 0.5 });
      guetteur.observe(figure);
    }

    if (tactile) return;

    var visee = -1;
    function cacher() {
      if (visee >= 0 && barres[visee]) barres[visee].classList.remove('est-visee');
      visee = -1;
      figure.classList.remove('est-survolee');
      bulle.hidden = true;
    }
    figure.addEventListener('pointermove', function (e) {
      var c = figure.getBoundingClientRect();
      var x = e.clientX - c.left;
      var i = Math.floor(x / pas);
      if (x < 0 || x > longueur || i < 0 || i >= barres.length) { cacher(); return; }
      if (i === visee) return;
      if (visee >= 0 && barres[visee]) barres[visee].classList.remove('est-visee');
      visee = i;
      barres[i].classList.add('est-visee');
      figure.classList.add('est-survolee');
      bulle.textContent = enTexte(t0 + i * 864e5) + ' · ' + unite(figure, jours[i]);
      bulle.hidden = false;
      bulle.style.left = (i * pas + (pas - ecart) / 2).toFixed(1) + 'px';
      bulle.style.top = '-8px';
    });
    figure.addEventListener('pointerleave', cacher);
  }

  function tout() {
    var figures = document.querySelectorAll('figure.activite[data-jours]');
    for (var i = 0; i < figures.length; i++) monter(figures[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tout);
  } else {
    tout();
  }
})();
