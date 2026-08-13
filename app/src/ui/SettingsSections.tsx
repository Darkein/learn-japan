import { useEffect, useState } from "react";
import { pushAvailable, syncPushSubscription, type PushState } from "../lib/push";
import { ensurePeriodicSync, showReminderNow } from "../lib/reminders";
import { formatBytes, getStorageInfo, requestPersistentStorage, type StorageInfo } from "../lib/storage";
import { useSettings, THEMES, READER_FONT_SCALES } from "./useSettings";
import { Toggle } from "./kit/Toggle";
import { SegmentedControl } from "./kit/SegmentedControl";
import { SectionLabel } from "./kit/SectionLabel";
import { SyncSection } from "./SyncSection";

interface Props {
  /** Mode compact du tiroir latéral : masque la section Révision (réglages avancés)
   * et étire les bascules sur la largeur. La page « Tous les paramètres » affiche tout. */
  quick?: boolean;
}

/** Contenu des réglages, partagé entre la page Settings et le tiroir SettingsPanel —
 * mêmes libellés et mêmes sections partout, une seule source. */
export function SettingsSections({ quick }: Props) {
  const { settings, update } = useSettings();

  return (
    <div className={`flex flex-col ${quick ? "gap-6" : "gap-8"}`}>
      <section>
        <SectionLabel as="h3" className="mb-3">Affichage</SectionLabel>
        <div className="flex flex-col gap-3">
          <Toggle
            label="Furigana par défaut"
            value={settings.furiganaDefault}
            onChange={(v) => update({ furiganaDefault: v })}
          />
          <Toggle
            label="Gloss par défaut"
            value={settings.glossDefault}
            onChange={(v) => update({ glossDefault: v })}
          />
          <Toggle
            label="Masquer gloss et furigana des mots connus"
            value={settings.glossHideKnown}
            onChange={(v) => update({ glossHideKnown: v })}
          />
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text">Taille du texte</span>
            {/* Toujours pleine largeur : le tiroir rapide est étroit (5 crans courts y tiennent
             *  déjà), et la page « Tous les paramètres » a largement la place, mobile compris. */}
            <SegmentedControl
              fullWidth
              options={READER_FONT_SCALES.map((s) => ({ value: s.value, label: s.label }))}
              value={settings.readerFontScale}
              onChange={(v) => update({ readerFontScale: v })}
              ariaLabel="Taille du texte des leçons, histoires et articles"
            />
          </div>
        </div>
      </section>

      {/* La vitesse de lecture se règle directement dans le lecteur audio (bouton « 1× »). */}

      {!quick && (
        <section>
          <SectionLabel as="h3" className="mb-3">Révision</SectionLabel>
          <div className="flex flex-col gap-4">
            <NumberRow
              label="Objectif quotidien (cartes)"
              value={settings.dailyGoal}
              min={1}
              onChange={(v) => update({ dailyGoal: v })}
            />
            <NumberRow
              label="Nouveaux mots par jour"
              value={settings.newPerDay}
              min={1}
              onChange={(v) => update({ newPerDay: v })}
            />
            <Toggle
              label="Romaji → kana dans les révisions"
              value={settings.warmupRomaji}
              onChange={(v) => update({ warmupRomaji: v })}
            />
            <Toggle
              label="Sans le son : remplacer l'écoute par de l'écrit"
              value={settings.silentReviews}
              onChange={(v) => update({ silentReviews: v })}
            />
            {/* Pause posée depuis une carte (« Je ne peux pas écouter ») : elle expire
                d'elle-même, mais reste annulable ici — sinon rien ne l'explique. */}
            {settings.silentUntil > Date.now() && (
              <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted">
                Écoute en pause encore{" "}
                {Math.ceil((settings.silentUntil - Date.now()) / 60000)} min.
                <button
                  className="cursor-pointer text-xs text-muted underline"
                  onClick={() => update({ silentUntil: 0 })}
                >
                  Réactiver le son
                </button>
              </p>
            )}
          </div>
        </section>
      )}

      {!quick && <ReminderSection />}

      {!quick && <SyncSection />}

      {!quick && <StorageSection />}

      <section>
        <SectionLabel as="h3" className="mb-3">Thème</SectionLabel>
        <SegmentedControl
          fullWidth={quick}
          options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
          value={settings.theme}
          onChange={(v) => update({ theme: v })}
          ariaLabel="Thème"
        />
      </section>
    </div>
  );
}

/** Heures proposées : la nuit n'a pas d'intérêt pour un rappel d'étude. */
const REMINDER_HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

/** iOS n'autorise les notifications web QUE dans une app ajoutée à l'écran d'accueil. Sans ce
 *  message, `requestPermission()` échoue sans que rien ne l'explique. (iPadOS se déclare
 *  « Macintosh » : on le reconnaît à la présence du tactile.) */
function appleNeedsInstall(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const apple = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return apple && !window.matchMedia("(display-mode: standalone)").matches;
}

/** Ce que l'état du push signifie CONCRÈTEMENT pour l'utilisateur — jamais un code d'erreur. */
const PUSH_NOTE: Partial<Record<PushState, string>> = {
  subscribed: "Rappel programmé actif : il arrivera à l'heure choisie, même app fermée.",
  denied:
    "Les notifications sont bloquées pour ce site. À réautoriser dans les réglages du navigateur (ou du système).",
  unsupported:
    "Ce navigateur ne sait pas recevoir de rappel programmé. Tu seras rappelé à l'ouverture de l'app.",
  unconfigured:
    "Le rappel programmé n'est pas configuré côté serveur. Seul le rappel à l'ouverture de l'app fonctionnera.",
  error:
    "Serveur injoignable : le rappel programmé sera réessayé au prochain démarrage de l'app.",
};

/**
 * Rappel du programme du jour. Trois choses valent d'être dites ici plutôt que devinées :
 * l'heure est libre, iOS exige l'installation, et un bouton d'essai évite d'attendre l'heure
 * dite pour découvrir que la permission manquait.
 */
function ReminderSection() {
  const { settings, update } = useSettings();
  const { enabled, hour } = settings.reminders;
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [tested, setTested] = useState(false);

  // État de l'abonnement DÈS L'OUVERTURE des réglages (la section n'est montée que là).
  // Sans ça, un abonnement cassé — permission révoquée, Worker injoignable, navigateur sans
  // pushManager — reste invisible : « Tester le rappel » marche toujours, lui, puisqu'il
  // n'emprunte ni le réseau ni le serveur. Réabonner au passage ne coûte rien (idempotent)
  // et répare l'abonnement le cas échéant.
  useEffect(() => {
    if (!enabled) {
      setPushState(null);
      return;
    }
    let alive = true;
    void syncPushSubscription(settings.reminders).then((s) => {
      if (alive) setPushState(s);
    });
    return () => {
      alive = false;
    };
    // Même dépendance que `initReminders` (App.tsx) : l'objet ne change que si un réglage de
    // rappel change. C'est donc aussi ce qui redéclare la nouvelle heure au Worker, qui la
    // garde par abonnement — la ranger en local ne suffirait pas.
  }, [enabled, settings.reminders]);

  async function toggle(next: boolean) {
    setError(null);
    setTested(false);
    if (next) {
      if (typeof Notification === "undefined") {
        setError("Les notifications ne sont pas disponibles dans ce navigateur.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError(
          appleNeedsInstall()
            ? "Autorisation refusée. Sur iPhone, il faut d'abord ajouter l'app à l'écran d'accueil."
            : "Autorisation refusée par le navigateur — rappels impossibles.",
        );
        return;
      }
    }
    const reminders = { ...settings.reminders, enabled: next };
    update({ reminders });
    void ensurePeriodicSync(next);
    // Activer : l'effet ci-dessus s'en charge (et affiche l'état). Couper, en revanche, doit
    // être dit au Worker — sans désabonnement il continuerait d'envoyer le rappel du soir.
    if (!next) void syncPushSubscription(reminders);
  }

  function changeHour(next: number) {
    // Le Worker garde l'heure par abonnement : la redéclarer est indispensable, et c'est
    // l'effet (dépendant de `hour`) qui le fait — ici on ne fait que ranger le réglage.
    update({ reminders: { ...settings.reminders, hour: next } });
  }

  return (
    <section>
      <SectionLabel as="h3" className="mb-3">Rappels</SectionLabel>
      <div className="flex flex-col gap-3">
        <Toggle
          label="Me rappeler mes exercices du jour"
          value={enabled}
          onChange={(v) => void toggle(v)}
        />
        {error && <p className="m-0 text-sm text-accent">{error}</p>}
        {enabled && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">Heure du rappel</span>
              <select
                className="h-11 rounded-sm border border-hairline-strong bg-surface px-2 text-right text-sm text-text"
                value={hour}
                aria-label="Heure du rappel"
                onChange={(e) => changeHour(Number(e.target.value))}
              >
                {REMINDER_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="h-11 rounded-sm border border-hairline-strong bg-surface px-3 text-sm text-text"
              onClick={() => void showReminderNow().then(setTested)}
            >
              Tester le rappel
            </button>
            {tested && (
              <p className="m-0 text-xs leading-relaxed text-muted">
                Notification envoyée — si tu ne la vois pas, vérifie les réglages système.
              </p>
            )}
            {pushState && PUSH_NOTE[pushState] && (
              <p className="m-0 text-xs leading-relaxed text-muted">{PUSH_NOTE[pushState]}</p>
            )}
          </>
        )}
        {appleNeedsInstall() && (
          <p className="m-0 text-xs leading-relaxed text-muted">
            Sur iPhone et iPad, ajoute d'abord l'app à l'écran d'accueil (Partager → « Sur
            l'écran d'accueil ») : iOS n'autorise les notifications que dans ce mode.
          </p>
        )}
        <p className="m-0 text-xs leading-relaxed text-muted">
          {pushAvailable()
            ? "À l'heure choisie, un rappel arrive même app fermée si ton programme du jour n'est pas terminé. Seuls un identifiant d'appareil opaque, l'heure et le fuseau quittent l'appareil — jamais ton contenu d'étude, qui reste calculé localement."
            : "Rappel au mieux des capacités du navigateur (app installée recommandée). Aucune donnée ne quitte l'appareil."}
        </p>
      </div>
    </section>
  );
}

/** Usage/quota + persistance du stockage : la garantie que les téléchargements hors-ligne
 * (audio, histoires, SRS) ne seront pas purgés par le navigateur sous pression de stockage. */
function StorageSection() {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    void getStorageInfo().then(setInfo);
  }, []);

  async function askPersist() {
    await requestPersistentStorage();
    setInfo(await getStorageInfo());
  }

  return (
    <section>
      <SectionLabel as="h3" className="mb-3">Stockage</SectionLabel>
      <div className="flex flex-col gap-3">
        {info?.usage != null && info?.quota != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-text">Espace utilisé</span>
            <span className="text-sm text-muted">
              {formatBytes(info.usage)} sur {formatBytes(info.quota)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-text">Stockage persistant</span>
          <span className="text-sm text-muted">{info == null ? "…" : info.persisted ? "Actif" : "Non garanti"}</span>
        </div>
        {info != null && !info.persisted && (
          <>
            <p className="m-0 text-xs leading-relaxed text-muted">
              Sans persistance, le navigateur peut purger les données hors-ligne (audio
              téléchargé, histoires, révisions) s'il manque d'espace. Installer l'app sur
              l'écran d'accueil aide à l'obtenir.
            </p>
            <button
              type="button"
              className="h-11 rounded-sm border border-hairline-strong bg-surface px-3 text-sm text-text"
              onClick={() => void askPersist()}
            >
              Demander la persistance
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function NumberRow({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        className="h-11 w-20 rounded-sm border border-hairline-strong bg-surface px-2 text-right text-sm text-text"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= min) onChange(n);
        }}
      />
    </div>
  );
}
