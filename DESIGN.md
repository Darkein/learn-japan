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
- ❌ Ombres portées / `box-shadow` décoratives, cartes flottantes `rounded-2xl`.
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
| `--surface` | `#1E1B16` | panneaux, feuilles |
| `--surface-2` | `#272219` | survol / élévation discrète |
| `--text` | `#E8E2D4` | texte principal (papier) |
| `--text-muted` | `#9C9584` | texte secondaire |
| `--accent` | `#D8503C` | vermillon 朱 (accent unique) |
| `--accent-2` | `#7C8FC0` | indigo 藍 (secondaire, rare) |
| `--hairline` | `rgba(232,226,212,0.10)` | filets / bordures |

### Couleur — Light (washi)
| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#F7F3EC` | papier washi |
| `--surface` | `#FFFFFF` | panneaux |
| `--surface-2` | `#F0EADF` | survol |
| `--text` | `#1A1815` | encre sumi |
| `--text-muted` | `#6F6857` | secondaire |
| `--accent` | `#C0392B` | vermillon 朱 |
| `--accent-2` | `#2E4374` | indigo 藍 |
| `--hairline` | `rgba(26,24,21,0.12)` | filets |

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
- **Échelle** (modulaire ~1.25) : `--fs-xs .75rem`, `--fs-sm .875rem`, `--fs-base 1rem`,
  `--fs-lg 1.25rem`, `--fs-xl 1.625rem`, `--fs-2xl 2.25rem`, `--fs-3xl 3rem`.
- **Lecture JP** : `line-height: 2` (pour loger les furigana), letter-spacing neutre.
- **Méta / labels** : `--font-sans`, petites capitales, `letter-spacing: .06em`, `--text-muted`.

### Espacement (échelle 4px) & rayons
- `--sp-1 4px … --sp-2 8px, --sp-3 12px, --sp-4 16px, --sp-6 24px, --sp-8 32px, --sp-12 48px,
  --sp-16 64px`.
- `--radius-sm 4px`, `--radius 6px` (max). `--hairline-w 1px`.
- **Pas de** token d'ombre. L'élévation se signale par `--surface`/`--surface-2` + filet.

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
- **Boutons** : texte + filet (ghost) par défaut ; bouton primaire = aplat `--accent`, texte
  papier ; rayon `--radius-sm`. Jamais d'ombre, jamais de dégradé.
- **Listes (catalogue)** : lignes séparées par filets, libellés méta en petites capitales.
- **Barre de progression** : filet de fond + remplissage `--accent`, hauteur 2–3px.

## 7. Accessibilité

- Contraste texte/bg ≥ 7:1 (dark) et ≥ 8:1 (light) sur le texte principal.
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
