import { useEffect, useState } from "react";
import {
  disconnectSync,
  generateSyncCode,
  getLastSyncAt,
  getSyncCode,
  normalizeSyncCode,
  pullProgress,
  pushProgress,
  setSyncCode,
} from "../lib/sync";
import { Button } from "./kit/Button";
import { SectionLabel } from "./kit/SectionLabel";
import { useNotify } from "./useNotify";

/** « à l'instant », « il y a 12 min », « il y a 3 h », « il y a 2 jours ». */
function formatAgo(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  return days === 1 ? "hier" : `il y a ${days} jours`;
}

/**
 * Section « Synchronisation » des options : sauvegarde cloud par code de session
 * (voir lib/sync.ts). Le code est le seul secret — le montrer, le copier, en saisir un.
 */
export function SyncSection() {
  const { notify } = useNotify();
  const [code, setCode] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const [c, at] = await Promise.all([getSyncCode(), getLastSyncAt()]);
    setCode(c);
    setLastSyncAt(at);
    setLoaded(true);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      await setSyncCode(generateSyncCode());
      const res = await pushProgress();
      if (res === "pushed") {
        notify({ message: "Synchronisation activée — note ton code quelque part." });
      } else {
        setError(res === "offline" ? "Hors-ligne — le code est créé, l'envoi se fera plus tard." : "Envoi impossible pour le moment.");
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await pushProgress();
      if (res === "pushed" || res === "skipped") {
        notify({ message: res === "pushed" ? "Progrès synchronisé." : "Déjà à jour." });
      } else if (res === "conflict") {
        notify({
          message: "Un autre appareil a envoyé une sauvegarde plus récente.",
          action: { label: "Écraser quand même", onClick: () => void pushProgress({ force: true }).then(() => void refresh()) },
        });
      } else {
        setError(res === "offline" ? "Hors-ligne — réessaie plus tard." : "Synchronisation impossible pour le moment.");
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function join() {
    const normalized = normalizeSyncCode(joinInput);
    if (!normalized) {
      setError("Code invalide — format attendu : XXXX-XXXX-XXXX.");
      return;
    }
    if (!window.confirm("Ton avancement actuel sera SUPPRIMÉ et remplacé par celui de ce code. Continuer ?")) return;
    setBusy(true);
    setError(null);
    const previous = code;
    try {
      await setSyncCode(normalized);
      const res = await pullProgress();
      if (res === "replaced") {
        location.reload();
        return;
      }
      // Échec : on restaure la session précédente, rien n'a été remplacé.
      if (previous) await setSyncCode(previous);
      else await disconnectSync();
      setError(
        res === "not_found"
          ? "Code inconnu — vérifie la saisie."
          : res === "offline"
            ? "Hors-ligne — réessaie plus tard."
            : "Récupération impossible pour le moment.",
      );
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function disconnect() {
    if (!window.confirm("Déconnecter cet appareil ? La sauvegarde en ligne est conservée ; ce code restera utilisable.")) return;
    await disconnectSync();
    setJoinInput("");
    setError(null);
    void refresh();
  }

  if (!loaded) return null;

  return (
    <section>
      <SectionLabel as="h3" className="mb-3">Synchronisation</SectionLabel>
      <div className="flex flex-col gap-3">
        {code ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">Code de session</span>
              <span className="flex items-center gap-2">
                <code className="rounded-sm border border-hairline bg-surface-2 px-2 py-1 font-mono text-sm text-text">{code}</code>
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code).then(() => notify({ message: "Code copié." }));
                  }}
                >
                  Copier
                </Button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void syncNow()} disabled={busy}>
                {busy ? "Synchronisation…" : "Synchroniser maintenant"}
              </Button>
              <span className="text-xs text-muted">
                {lastSyncAt ? `Dernière synchro ${formatAgo(lastSyncAt)}` : "Jamais synchronisé"}
              </span>
            </div>
            <p className="m-0 text-xs leading-relaxed text-muted">
              Entre ce code sur un autre appareil pour y retrouver ton avancement. La
              synchronisation se fait aussi toute seule toutes les 5 minutes.
            </p>
          </>
        ) : (
          <>
            <Button onClick={() => void activate()} disabled={busy}>
              {busy ? "Activation…" : "Activer la synchronisation"}
            </Button>
            <p className="m-0 text-xs leading-relaxed text-muted">
              Crée un code de session et sauvegarde ton avancement en ligne. Aucun compte —
              le code est la seule clé, garde-le précieusement.
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={joinInput}
            placeholder="XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 w-44 rounded-sm border border-hairline-strong bg-surface px-2 font-mono text-sm uppercase text-text"
            onChange={(e) => setJoinInput(e.target.value)}
          />
          <Button onClick={() => void join()} disabled={busy || !joinInput.trim()}>
            {code ? "Changer de session" : "J'ai déjà un code"}
          </Button>
        </div>
        {error && <p className="m-0 text-sm text-accent">{error}</p>}

        {code && (
          <Button variant="quiet" className="self-start" onClick={() => void disconnect()}>
            Déconnecter cet appareil
          </Button>
        )}
      </div>
    </section>
  );
}
