# DESIGN.md — Système de design « Sumi & Washi »

> Source de vérité unique du style. Toute décision visuelle s'aligne sur ce document.
> Les **CSS variables** (`app/src/styles/theme.css`) **dérivent** de ces tokens — ne pas
> introduire de couleurs/ombres/espacements en dur ailleurs.

## 1. Intentions

Une app de **lecture** japonaise : le design est **piloté par la typographie**, calme, éditorial,
inspiré de l'estampe et de l'édition japonaises (encre *sumi* sur papier *washi*). Minimaliste et
moderne **sans ressembler** aux UI génériques (Tailwind UI / shadcn). On cherche du **caractère par
la retenue** : vide, hiérarchie typographique, un seul accent.

**Mots-clés :** *ma* (間, le vide qui respire), encre, papier, filets fins, silence visuel.

## 2. Principes (règles dures)

**À faire**
- Laisser **respirer** : marges généreuses, peu d'éléments par écran.
- Hiérarchie par la **typographie et l'espace**, pas par des boîtes.
- **Filets de 1px** (hairlines) pour séparer, au lieu d'ombres.
- **Un seul accent** (vermillon 朱) par écran ; l'indigo 藍 en accent secondaire rare.
- Couleurs issues **exclusivement** des tokens (§4).
- Mouvement **discret** : transitions courtes (≤180ms), easing doux, jamais de rebond.

**À éviter (anti-patterns)**
- ❌ Ombres **décoratives ou colorées**, cartes flottantes `rounded-2xl`. Une **unique ombre
  d'élévation** (`--elev`, monochrome, blur ≤ 10px) est permise sur les panneaux/feuilles pour
  les détacher du fond — jamais sur le texte, jamais en plusieurs couches visibles.
- ❌ Dégradés tape-à-l'œil, néons, couleurs fluo (y compris pour les états de révision).
- ❌ Librairies de composants génériques (shadcn, Tailwind UI, Material) — rendu non sur-mesure.
- ❌ Coins très arrondis partout (rayon ≤ 6px ; souvent 0 sur les filets).
- ❌ Multiplier les accents ou les niveaux de gris.

## 3. Thème (dark par défaut, adaptatif)

- **Sombre par défaut.** Suit `prefers-color-scheme` (bascule auto clair/sombre).
- **Toggle manuel** persistant via `data-theme="dark|light"` sur `<html>` (override du système) ;
  `data-theme="system"` (ou absence) = suivre le système. Préférence stockée en `localStorage`.
- Les deux modes partagent la **même structure** ; seules les valeurs des tokens changent.

## 4. Tokens

### Couleur — Dark (défaut)
| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#15130F` | fond (sumi profond, chaud) |
| `--surface` | `#24201A` | panneaux, feuilles (nettement séparés du fond) |
| `--surface-2` | `#2F2920` | survol / élévation discrète |
| `--text` | `#E8E2D4` | texte principal (papier) — 14.4:1 sur `--bg` |
| `--text-muted` | `#B0A898` | texte secondaire — ≈7.9:1 sur `--bg` |
| `--accent` | `#D8503C` | vermillon 朱 (accent unique) |
| `--accent-2` | `#7C8FC0` | indigo 藍 (secondaire, rare) |
| `--on-accent` | `#15130F` | texte sur aplat `--accent` (l'encre — le blanc échoue AA) |
| `--hairline` | `rgba(232,226,212,0.14)` | filets décoratifs / séparateurs |
| `--hairline-strong` | `rgba(232,226,212,0.32)` | bordures **interactives** (boutons, inputs) |
| `--elev` | `0 1px 0 rgba(0,0,0,.25), 0 2px 10px rgba(0,0,0,.28)` | ombre d'élévation des panneaux |

### Couleur — Light (washi)
| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#F7F3EC` | papier washi |
| `--surface` | `#FFFFFF` | panneaux (détachés par `--elev` + hairline) |
| `--surface-2` | `#EDE6D8` | survol / états actifs |
| `--text` | `#1A1815` | encre sumi |
| `--text-muted` | `#544E40` | secondaire — ≈7.5:1 sur `--bg` |
| `--accent` | `#C0392B` | vermillon 朱 |
| `--accent-2` | `#2E4374` | indigo 藍 |
| `--on-accent` | `#FFF9F2` | texte sur aplat `--accent` (papier chaud, 5.2:1) |
| `--hairline` | `rgba(26,24,21,0.16)` | filets |
| `--hairline-strong` | `rgba(26,24,21,0.34)` | bordures interactives |
| `--elev` | `0 1px 2px rgba(26,24,21,.05), 0 3px 10px rgba(26,24,21,.07)` | élévation panneaux |

### États de révision (jamais fluo — teintes douces)
| Token | Dark | Light | Sens |
|---|---|---|---|
| `--state-unknown` | `--accent-2` ténu | idem | inconnu (jamais vu) |
| `--state-review` | vermillon désaturé | idem | à réviser (dû) |
| `--state-known` | `transparent`/neutre | idem | connu (neutre) |
Rendu : **soulignement filet** ou **teinte de fond très légère**, jamais de surlignage vif.

### Typographie
| Token | Valeur |
|---|---|
| `--font-serif` | `"Source Serif 4", "Noto Serif JP", Georgia, serif` (titres + lecture) |
| `--font-sans` | `"Inter", system-ui, "Noto Sans JP", sans-serif` (UI, méta) |
| `--font-jp` | `"Noto Serif JP", serif` (texte japonais en lecture) |
- **Échelle** (modulaire ~1.25) : `--fs-xs .8125rem`, `--fs-sm .875rem`, `--fs-base 1rem`,
  `--fs-lg 1.25rem`, `--fs-xl 1.625rem`, `--fs-2xl 2.25rem`, `--fs-3xl 3rem`.
- **Taille minimale absolue : `--fs-xs` (13px).** Aucune valeur arbitraire `text-[…]`
  inférieure, nulle part (y compris nav, player, badges).
- **Lecture JP** : `line-height: 2` (pour loger les furigana), letter-spacing neutre.
- **Méta / labels** : `--font-sans`, petites capitales, `letter-spacing: .06em`, `--text-muted`.

### Espacement (échelle 4px) & rayons
- `--sp-1 4px … --sp-2 8px, --sp-3 12px, --sp-4 16px, --sp-6 24px, --sp-8 32px, --sp-12 48px,
  --sp-16 64px`.
- `--radius-sm 4px` (boutons), `--radius 6px` (cartes/panneaux, max). `--hairline-w 1px`.
- **Un seul token d'ombre : `--elev`** (§ couleurs). L'élévation = `--surface` + filet +
  `--elev`. Aucune autre ombre, jamais.

### Mouvement
- `--dur 140ms`, `--dur-slow 180ms`, `--ease cubic-bezier(.2,.0,.2,1)`.

## 5. Ruby / furigana

- Élément natif `<ruby>` + `<rt>`. `rt { font-size: .5em; color: var(--text-muted);
  font-family: var(--font-sans); }`.
- Furigana **non affichés en continu** par défaut (cf. SPEC §10) : visibles **au tap** ou via un
  toggle. État « révélé » = couleur légèrement plus présente, jamais l'accent.
- Le **gloss littéral** (interlinéaire) s'affiche **sous** la phrase, en `--font-sans`,
  `--text-muted`, séparé par des points médians `·`.

## 6. Composants (esquisse, sur-mesure)

- **Mot dans le texte** : pas de boîte. État de révision via soulignement filet (couleur =
  token d'état). Tap → **feuille** (sheet) latérale/inférieure, bord supérieur = filet, pas d'ombre.
- **Boutons** (tous via `kit/Button.tsx`, jamais de classes ad hoc) :
  - *ghost* (défaut) : fond `--surface` + filet `--hairline-strong` — jamais la hairline
    décorative seule, un bouton doit se voir ;
  - *primary* : aplat `--accent`, texte `--on-accent` (un seul par écran) ;
  - *quiet* : texte seul, pour le tertiaire (liens d'action, fermeture) ;
  - rayon `--radius-sm` ; désactivé = opacité 50 % uniquement (jamais 30/40) ;
  - icônes = **SVG du kit** (`kit/Icon.tsx`, trait 1.5, `currentColor`), jamais de glyphes
    unicode/emoji (⚙ ▶ ✕…) au rendu variable selon la plateforme.
- **Listes (catalogue)** : lignes séparées par filets, libellés méta en petites capitales.
- **Barre de progression** : filet de fond + remplissage `--accent`, hauteur 2–3px.

## 7. Accessibilité

- Contraste : texte principal **et secondaire** ≥ 7:1 sur `--bg` (dark comme light) ;
  ≥ 4.5:1 minimum sur les surfaces (`--surface`, `--surface-2`, aplat `--accent`).
- Cibles tactiles ≥ 44px. Focus visible (filet `--accent`, 2px).
- `prefers-reduced-motion` : désactiver les transitions non essentielles.

## 8. Mise en œuvre

- Tokens dans `app/src/styles/theme.css` (couleurs, `:root` = dark ; `@media
  (prefers-color-scheme: light)` et `[data-theme="light"]` = washi ; `[data-theme="dark"]`
  force le sombre) et `app/src/styles/global.css` (`@theme` : typo, rayons, mouvement,
  exposés comme utilitaires Tailwind).
- Styles composant en **classes utilitaires Tailwind v4**, consommant **uniquement** les
  tokens ci-dessus (`bg-bg`, `text-muted`, `border-hairline`, `text-accent`…) — jamais de
  couleur/rayon/ombre en dur.
- Les patterns qui se répètent (bouton, panneau, badge, filet de progression, toggle,
  groupe de bascules, feuille/tiroir) vivent dans `app/src/ui/kit/` : composants sur-mesure
  qui encapsulent ces classes Tailwind, pas une librairie de composants générique.
- **Mobile-first** : les classes sans préfixe ciblent le téléphone ; `sm:` (40rem) élargit
  pour un grand téléphone/petite tablette ; `min-[60rem]:` réintroduit les vues desktop
  (splits liste/détail). Aucun style ne part du desktop.
- Toute nouvelle couleur passe d'abord par un token ajouté ici.
