import { useEffect, useRef, useState } from "react";
import { getMeta, getStoryImage, onStoryImageSaved, putMeta } from "../lib/db";
import { backfillStoryImage } from "../lib/lessons";

/** Clé du marqueur persistant « backfill déjà tenté sans image » (évite de re-appeler
 * /generate à chaque rechargement pour une histoire sans illustration en cache R2). */
const triedKey = (id: string) => `storyImageTried:${id}`;

interface Props {
  /** Id de l'histoire en base. Absent (lecture non enregistrée) → pas d'illustration. */
  storyId?: string;
  /** Miniature (cartes de listes) : petite vignette, jamais de backfill réseau. */
  thumb?: boolean;
}

/** Ids dont le backfill a déjà été tenté cette session — une seule requête par histoire. */
const backfillTried = new Set<string>();

/**
 * Illustration ukiyo-e d'une histoire, générée avec le texte côté Worker et cachée
 * localement (store `storyImages`). Purement décoratif. Si l'histoire n'a pas d'image
 * (générée avant la fonctionnalité d'illustration), on tente une fois de la rapatrier
 * depuis le cache Worker (`backfillStoryImage`) ; sinon on n'affiche rien.
 */
export function StoryIllustration({ storyId, thumb }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setLoading(!!storyId);
    if (!storyId) return;
    const id = storyId;

    const show = (blob: Blob | null) => {
      if (cancelled) return;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = blob ? URL.createObjectURL(blob) : null;
      setUrl(objectUrlRef.current);
      setLoading(false);
    };

    getStoryImage(id)
      .then(async (blob) => {
        if (cancelled) return;
        if (blob) return show(blob);
        if (thumb || backfillTried.has(id) || !navigator.onLine) return show(null);
        if (await getMeta<boolean>(triedKey(id))) return show(null);
        backfillTried.add(id);
        const filled = await backfillStoryImage(id);
        if (cancelled) return;
        // Aucune image côté Worker : marqueur persistant → plus de re-tentative aux
        // prochains chargements (le Set en mémoire, lui, est vidé à chaque reload).
        if (!filled) await putMeta(triedKey(id), true);
        show(filled);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    // Mise à jour en direct : image écrite après le montage (génération inline best-effort
    // arrivée en retard, ou backfill depuis un autre écran) → la vignette s'affiche sans reload.
    const unsub = onStoryImageSaved((savedId) => {
      if (savedId !== id) return;
      void getStoryImage(id).then((blob) => blob && show(blob));
    });

    return () => {
      cancelled = true;
      unsub();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [storyId, thumb]);

  if (!url) {
    if (!loading) return null;
    return (
      <div
        aria-hidden="true"
        className={
          thumb
            ? "h-12 w-12 shrink-0 animate-pulse rounded-sm border border-hairline bg-surface-2"
            : "aspect-[4/3] w-full animate-pulse rounded-md border border-hairline bg-surface-2"
        }
      />
    );
  }

  return (
    <img
      src={url}
      alt="Illustration de l'histoire"
      loading="lazy"
      className={
        thumb
          ? "h-12 w-12 shrink-0 rounded-sm border border-hairline object-cover"
          : "w-full max-w-full rounded-md border border-hairline object-cover"
      }
    />
  );
}
