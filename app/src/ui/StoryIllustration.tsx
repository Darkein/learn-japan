import { useEffect, useState } from "react";
import { getStoryImage } from "../lib/db";
import { backfillStoryImage } from "../lib/lessons";

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

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (storyId) {
      const id = storyId;
      const show = (blob: Blob | null) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      };
      getStoryImage(id)
        .then(async (blob) => {
          if (blob || cancelled) return show(blob);
          if (thumb || backfillTried.has(id) || !navigator.onLine) return;
          backfillTried.add(id);
          show(await backfillStoryImage(id));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storyId, thumb]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt="Illustration de l'histoire"
      loading="lazy"
      className={
        thumb
          ? "h-16 w-16 shrink-0 rounded-sm border border-hairline object-cover"
          : "w-full max-w-full rounded-md border border-hairline object-cover"
      }
    />
  );
}
