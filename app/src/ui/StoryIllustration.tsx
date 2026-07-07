import { useEffect, useState } from "react";
import { getStoryImage } from "../lib/db";

interface Props {
  /** Id de l'histoire en base. Absent (lecture non enregistrée) → pas d'illustration. */
  storyId?: string;
}

/**
 * Illustration ukiyo-e d'une histoire, générée avec le texte côté Worker et cachée
 * localement (store `storyImages`). Purement décoratif : on se contente de LIRE le cache —
 * aucune génération ici. Si l'histoire n'a pas (encore) d'image, on n'affiche rien.
 */
export function StoryIllustration({ storyId }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (storyId) {
      getStoryImage(storyId)
        .then((blob) => {
          if (cancelled || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storyId]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt="Illustration de l'histoire"
      loading="lazy"
      className="w-full max-w-full rounded-md border border-hairline object-cover"
    />
  );
}
