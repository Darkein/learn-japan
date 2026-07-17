// Barre de progression sur UNE ligne, partagée par les scripts de génération
// (build-mnemonics, build-word-mnemonics). TTY → réécrit la même ligne (\r), masque le
// curseur, ETA basée sur les items RÉELLEMENT traités (hors repris). Non interactif (CI) →
// une ligne périodique tous les 10 items (les \r y seraient illisibles).

export type Outcome = "ok" | "skipped" | "empty" | "failed";

export interface ProgressBar {
  readonly stats: Record<Outcome, number>;
  /** Aperçu « en cours » avant l'appel réseau (TTY uniquement). */
  preview(current: string): void;
  /** Enregistre l'issue d'un item et redessine. */
  tick(outcome: Outcome, current: string): void;
  /** Termine la barre : nouvelle ligne + curseur restauré. */
  finish(): void;
}

const BAR_WIDTH = 22;

/**
 * @param total     Nombre total d'items à parcourir (repris inclus) — pilote la jauge.
 * @param toProcess Nombre d'items réellement à générer (hors repris) — pilote l'ETA.
 */
export function createProgressBar(total: number, toProcess: number): ProgressBar {
  const started = Date.now();
  const isTty = process.stdout.isTTY === true;
  const stats: Record<Outcome, number> = { ok: 0, skipped: 0, empty: 0, failed: 0 };
  let done = 0;
  let processed = 0;

  const render = (current: string): string => {
    const ratio = total ? done / total : 1;
    const filled = Math.round(BAR_WIDTH * ratio);
    const gauge = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    const pct = String(Math.round(ratio * 100)).padStart(3);
    const elapsed = (Date.now() - started) / 1000;
    const rate = processed / Math.max(elapsed, 0.001); // items générés / s (hors repris)
    const etaS = processed >= 2 && rate > 0 ? Math.round((toProcess - processed) / rate) : 0;
    const eta = etaS > 0 ? ` · ~${Math.floor(etaS / 60)}m${String(etaS % 60).padStart(2, "0")}` : "";
    // Marqueurs à largeur fixe (1 cellule) : pas d'emoji « next track » qui, rendu sur
    // 2 cellules par certains terminaux, chevaucherait le chiffre suivant.
    const counts =
      `✓${stats.ok} »${stats.skipped}` +
      (stats.empty ? ` ⚠${stats.empty}` : "") +
      (stats.failed ? ` ✗${stats.failed}` : "");
    return `${gauge} ${pct}% ${done}/${total} ${counts}${eta}  ${current}`;
  };

  const draw = (current: string): void => {
    if (isTty) process.stdout.write(`\r${render(current)}\x1b[K`);
    else if (done % 10 === 0 || done === total) console.log(render(current));
  };

  // Masque le curseur pendant la barre (il clignoterait en fin de ligne) et le restaure à
  // coup sûr : fin normale, erreur, ou Ctrl-C (sinon le terminal resterait sans curseur).
  const showCursor = (): void => {
    if (isTty) process.stdout.write("\x1b[?25h");
  };
  if (isTty) {
    process.stdout.write("\x1b[?25l");
    process.on("exit", showCursor);
    process.on("SIGINT", () => {
      showCursor();
      process.stdout.write("\n");
      process.exit(130);
    });
  }

  return {
    stats,
    preview(current: string): void {
      if (isTty) draw(`${current} …`);
    },
    tick(outcome: Outcome, current: string): void {
      stats[outcome]++;
      done++;
      if (outcome !== "skipped") processed++;
      draw(current);
    },
    finish(): void {
      if (isTty) process.stdout.write("\n");
      showCursor();
    },
  };
}
