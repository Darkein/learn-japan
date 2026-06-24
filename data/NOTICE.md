# Données de référence — sources & licences

Les données linguistiques proviennent de bases libres. Attribution requise.

| Donnée | Source | Licence |
|---|---|---|
| Inventaire kanji (lectures, sens EN, niveaux JLPT N5–N1) | [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data) — agrège KANJIDIC + listes JLPT de J. Waller (champs WaniKani exclus) | MIT |
| Inventaire vocabulaire N5 (lecture, sens EN, niveau) | [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | MIT |
| Décomposition / radicaux | KRADFILE (EDRDG) | CC BY-SA 4.0 |
| Tracés / ordre des traits | KanjiVG | CC BY-SA 3.0 |
| Vocabulaire (gloss littéral FR/EN) | JMdict (EDRDG) | CC BY-SA 4.0 |
| Noms propres | JMnedict (EDRDG) | CC BY-SA 4.0 |
| Tokenisation (dictionnaire) | IPADIC via @sglkc/kuromoji | voir licence kuromoji/IPADIC |

EDRDG : Electronic Dictionary Research and Development Group, Monash University —
<https://www.edrdg.org/>. Voir leurs conditions : <https://www.edrdg.org/edrdg/licence.html>.

Les fichiers volumineux générés (`data/full/`) ne sont pas committés ; ils sont produits par les
scripts dans `/scripts`. Seuls de petits sous-ensembles de démonstration sont versionnés.
