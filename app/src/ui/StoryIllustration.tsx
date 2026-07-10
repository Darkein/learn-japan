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

// Cache mémoire borné des blobs d'illustration (par id d'histoire). Une image générée est
// immuable : on la garde pour initialiser l'affichage SYNCHRONE au remontage (l'histoire
// voisine, affichée en aperçu pendant le carrousel, charge le blob ; à la validation, la page
// active le retrouve dans le cache et l'affiche sans repasser par un état vide → pas de flash).
const IMG_CACHE_MAX = 16;
const imageCache = new Map<string, Blob>();
function cacheImage(id: string, blob: Blob) {
  imageCache.delete(id);
  imageCache.set(id, blob);
  if (imageCache.size > IMG_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
}

/**
 * Illustration ukiyo-e d'une histoire, générée avec le texte côté Worker et cachée
 * localement (store `storyImages`). Purement décoratif. Si l'histoire n'a pas d'image
 * (générée avant la fonctionnalité d'illustration), on tente une fois de la rapatrier
 * depuis le cache Worker (`backfillStoryImage`) ; sinon on n'affiche rien.
 */
export function StoryIllustration({ storyId, thumb }: Props) {
  const objectUrlRef = useRef<string | null>(null);
  const shownBlobRef = useRef<Blob | null>(null);
  // Initialisation synchrone depuis le cache mémoire : évite le flash au remontage.
  const [url, setUrl] = useState<string | null>(() => {
    const b = storyId ? imageCache.get(storyId) : undefined;
    if (!b) return null;
    const u = URL.createObjectURL(b);
    objectUrlRef.current = u;
    shownBlobRef.current = b;
    return u;
  });
  const [loading, setLoading] = useState(!!storyId && !objectUrlRef.current);

  useEffect(() => {
    let cancelled = false;
    const id = storyId;

    const show = (blob: Blob | null) => {
      if (cancelled) return;
      if (blob) cacheImage(id!, blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = blob ? URL.createObjectURL(blob) : null;
      shownBlobRef.current = blob;
      setUrl(objectUrlRef.current);
      setLoading(false);
    };

    if (!id) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const cached = imageCache.get(id);
    if (cached && shownBlobRef.current === cached) {
      // Déjà affiché depuis le cache (init d'état) : rien à recharger, pas de flash ni de
      // recréation d'URL (une image générée est immuable).
    } else if (cached) {
      show(cached); // changement d'id sur une instance réutilisée → affichage direct
    } else {
      setUrl(null);
      setLoading(true);
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
    }

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
