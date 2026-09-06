#!/usr/bin/env node
/* Remplit les lignes d'activité déclarées dans activite.config.json.

   Pour chaque cible : clone les dépôts sans les fichiers, compte les commits par
   jour du premier au dernier, et réécrit dans la page

     <figure class="activite" data-debut="…" data-jours="…" role="img" aria-label="…"></figure>

   plus, s'ils existent, <span class="activite-dernier"> et <span class="activite-total">.

     node activite.mjs              depuis GitHub (jeton ACTIVITE_TOKEN, sinon `gh auth token`)
     node activite.mjs --local      depuis les dossiers « local » de la configuration
     node activite.mjs blog         une seule cible

   Sort en 1 si une page n'a pas sa figure ou si un dépôt est injoignable : une
   ligne ne se rafraîchit jamais à moitié. Zéro dépendance. */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const SEULES = args.filter((a) => !a.startsWith('--'));

const cfg = JSON.parse(readFileSync(join(ROOT, 'activite.config.json'), 'utf8'));
const LANGUE = cfg.langue || 'fr';
const CIBLES = cfg.cibles || {};
const JOUR = 864e5;

const utc = (iso) => { const [a, m, j] = iso.split('-').map(Number); return Date.UTC(a, m - 1, j); };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const nombre = (n) => n.toLocaleString(LANGUE);
const echapper = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const fmtDate = new Intl.DateTimeFormat(LANGUE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateFr = (t) => fmtDate.format(new Date(t));

/* Le jeton n'est jamais affiché ni passé sur une ligne de commande. */
let jeton = process.env.ACTIVITE_TOKEN || '';
if (!LOCAL && !jeton) {
  try {
    jeton = execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { jeton = ''; }
}
const cacher = (s) => (jeton ? String(s).split(jeton).join('***') : String(s));

/* L'environnement de git. Le jeton va à TOUTES les commandes, pas au seul clone :
   un dépôt cloné sans ses fichiers en redemande à la lecture, et sans jeton git
   réclame un nom d'utilisateur qu'aucun robot ne peut donner. */
function envGit() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!LOCAL && jeton) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = `url.https://x-access-token:${jeton}@github.com/.insteadOf`;
    env.GIT_CONFIG_VALUE_0 = 'https://github.com/';
  }
  return env;
}

function datesDuDepot(depot, local, atelier) {
  let dossier = local;
  const env = envGit();
  if (!LOCAL) {
    dossier = join(atelier, depot.replace('/', '__'));
    try {
      execFileSync('git', ['clone', '--quiet', '--bare', '--filter=blob:none',
        `https://github.com/${depot}.git`, dossier],
        { env, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      throw new Error(`clone de ${depot} impossible : ${cacher(e.stderr || e.message).trim()}`);
    }
  } else if (!dossier || !existsSync(join(dossier, '.git'))) {
    throw new Error(`dossier local absent pour ${depot} : ${dossier || '(non déclaré)'}`);
  }
  /* la date d'auteur, courte, dans le fuseau enregistré : le jour où on a travaillé */
  try {
    return execFileSync('git', ['-C', dossier, 'log', '--format=%as', 'HEAD'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().split('\n').filter(Boolean);
  } catch (e) {
    throw new Error(`journal de ${depot} illisible : ${cacher(e.stderr || e.message).trim()}`);
  }
}

function compter(nom, cible, atelier) {
  const parJour = new Map();
  cible.depots.forEach((depot, i) => {
    for (const d of datesDuDepot(depot, (cible.local || [])[i], atelier)) {
      parJour.set(d, (parJour.get(d) || 0) + 1);
    }
  });
  if (!parJour.size) throw new Error(`${nom} : aucun commit`);
  const dates = [...parJour.keys()].sort();
  const debut = utc(dates[0]), fin = utc(dates[dates.length - 1]);
  const jours = [];
  for (let t = debut; t <= fin; t += JOUR) jours.push(parJour.get(iso(t)) || 0);
  return {
    debut, fin, jours,
    total: jours.reduce((s, n) => s + n, 0),
    actifs: jours.filter((n) => n > 0).length,
  };
}

function ecrire(cible, m) {
  const chemin = join(ROOT, cible.fichier);
  const avant = readFileSync(chemin, 'utf8');
  const label = (cfg.aria || 'Activité du dépôt, une barre par jour du {debut} au {fin} : {total} commits, {actifs} jours avec au moins un commit.')
    .replace('{debut}', dateFr(m.debut))
    .replace('{fin}', dateFr(m.fin))
    .replace('{total}', nombre(m.total))
    .replace('{actifs}', nombre(m.actifs));

  /* Une page peut porter plusieurs lignes : « marque » vise celle qui porte
     data-cible="…". Sans marque, la première figure vide est remplie. */
  const marque = cible.marque
    ? `<figure class="activite" data-cible="${cible.marque}"`
    : '<figure class="activite"';
  const quoi = cible.marque
    ? new RegExp(`<figure class="activite"[^>]*data-cible="${cible.marque}"[^>]*></figure>`)
    : /<figure class="activite"[^>]*><\/figure>/;
  if (!quoi.test(avant)) {
    throw new Error(`${cible.fichier} : pas de <figure class="activite"${cible.marque ? ` data-cible="${cible.marque}"` : ''}></figure> à remplir`);
  }
  const figure = `${marque} data-debut="${iso(m.debut)}" data-jours="${m.jours.join(',')}" role="img" aria-label="${echapper(label)}"></figure>`;
  let apres = avant.replace(quoi, figure);
  apres = apres.replace(/(<span class="activite-dernier">)[^<]*(<\/span>)/,
    `$1${(cfg.dernier || 'dernier commit le {date}').replace('{date}', dateFr(m.fin))}$2`);
  apres = apres.replace(/(<span class="activite-total">)[^<]*(<\/span>)/,
    `$1${(cfg.total || '{total} commits').replace('{total}', nombre(m.total))}$2`);

  if (apres === avant) return false;
  writeFileSync(chemin, apres);
  return true;
}

const atelier = LOCAL ? '' : mkdtempSync(join(tmpdir(), 'activite-'));
let erreurs = 0;
try {
  for (const [nom, cible] of Object.entries(CIBLES)) {
    if (SEULES.length && !SEULES.includes(nom)) continue;
    try {
      const m = compter(nom, cible, atelier);
      const change = ecrire(cible, m);
      console.log(`${nom.padEnd(12)} ${String(m.total).padStart(5)} commits, ${String(m.jours.length).padStart(4)} jours, du ${iso(m.debut)} au ${iso(m.fin)} : ${change ? 'mise à jour' : 'inchangée'}`);
    } catch (e) {
      erreurs++;
      console.error(`${nom.padEnd(12)} ERREUR : ${cacher(e.message)}`);
    }
  }
} finally {
  if (atelier) rmSync(atelier, { recursive: true, force: true });
}
process.exit(erreurs ? 1 : 0);
