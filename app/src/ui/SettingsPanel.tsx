import { currentLocation, navigate } from "./useHashRoute";
import { useSettings } from "./useSettings";
import { Button } from "./kit/Button";
import { IconClose } from "./kit/Icon";
import { Sheet } from "./kit/Sheet";
import { SettingsSections } from "./SettingsSections";

/** Tiroir latéral de réglages rapides : mêmes sections que la page Settings (mode
 * `quick` : sans la section Révision), plus le lien vers tous les paramètres. */
export function SettingsPanel() {
  const { panelOpen, closePanel } = useSettings();

  return (
    <Sheet open={panelOpen} onClose={closePanel} variant="right">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <span className="font-sans text-sm font-medium text-text">Réglages</span>
        <Button size="icon" variant="quiet" onClick={closePanel} aria-label="Fermer">
          <IconClose />
        </Button>
      </div>

      <div className="px-4 py-4">
        <SettingsSections quick />
      </div>

      <div className="mt-auto border-t border-hairline px-4 py-2">
        <Button
          variant="quiet"
          className="-ml-4"
          onClick={() => {
            closePanel();
            navigate(`/parametres?from=${encodeURIComponent(currentLocation())}`);
          }}
        >
          Tous les paramètres →
        </Button>
      </div>
    </Sheet>
  );
}
