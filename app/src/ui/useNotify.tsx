// Notifications globales légères (bandeau). Portées au niveau de l'app, elles survivent
// à la navigation entre onglets/pages : une génération lancée depuis l'accueil peut donc
// signaler qu'elle est prête même si l'utilisateur s'est baladé ailleurs entre-temps —
// sans le rediriger de force (cf. retours d'usage : un bandeau suffit, l'ouverture reste
// un choix explicite via l'action proposée).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface Notification {
  id: number;
  message: string;
  action?: NotificationAction;
}

interface NotifyApi {
  notifications: Notification[];
  notify: (n: Omit<Notification, "id">) => void;
  dismiss: (id: number) => void;
}

const NotifyContext = createContext<NotifyApi | null>(null);

// Durée d'affichage avant disparition automatique d'un bandeau.
const AUTO_DISMISS_MS = 12_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setNotifications((list) => list.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    (n: Omit<Notification, "id">) => {
      const id = nextId.current++;
      setNotifications((list) => [...list, { ...n, id }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<NotifyApi>(
    () => ({ notifications, notify, dismiss }),
    [notifications, notify, dismiss],
  );

  return <NotifyContext.Provider value={api}>{children}</NotifyContext.Provider>;
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error("useNotify doit être utilisé dans un <NotificationProvider>");
  return ctx;
}

/** Pile de bandeaux fixée en haut de l'écran. Filets, un seul accent (cf. DESIGN.md). */
export function NotificationBanner() {
  const { notifications, dismiss } = useNotify();
  if (notifications.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto flex w-full max-w-[28rem] items-center gap-3 rounded-sm border border-accent bg-surface px-4 py-3 shadow-elev"
        >
          <span className="flex-1 text-sm text-text">{n.message}</span>
          {n.action && (
            <button
              className="cursor-pointer whitespace-nowrap rounded-sm border border-accent px-3 py-1 text-sm text-accent transition-colors hover:bg-accent hover:text-on-accent"
              onClick={() => {
                n.action!.onClick();
                dismiss(n.id);
              }}
            >
              {n.action.label}
            </button>
          )}
          <button
            className="cursor-pointer px-1 text-lg leading-none text-muted transition-colors hover:text-text"
            aria-label="Fermer"
            onClick={() => dismiss(n.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
