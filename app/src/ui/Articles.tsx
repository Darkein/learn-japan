import { useEffect, useState } from "react";
import { allArticles, deleteStory, type StoryRecord } from "../lib/db";
import { importArticleFromUrl, saveArticle, ArticleImportError } from "../lib/articleExtract";
import { DownloadButton } from "./DownloadButton";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { IconArrowRight, IconClose, IconPause, IconPlay } from "./kit/Icon";
import { LoadingScreen } from "./kit/LoadingScreen";
import { SectionLabel } from "./kit/SectionLabel";
import { ReadabilityBadge } from "./ReadabilityBadge";
import { useGenJobs } from "./useGenJobs";
import { usePodcastPlayer } from "./usePodcastPlayer";

interface Props {
  /** Ouvre un article dans la page de lecture. */
  onOpen: (article: StoryRecord) => void;
}

/** Onglet Articles : liste des articles importés + panneau d'import (URL ou texte collé). */
export function Articles({ onOpen }: Props) {
  const [articles, setArticles] = useState<StoryRecord[] | null>(null);
  const { dataVersion } = useGenJobs();
  const podcast = usePodcastPlayer();

  async function refresh() {
    setArticles(await allArticles());
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  async function remove(id: string) {
    await deleteStory(id);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {articles === null ? (
        <LoadingScreen />
      ) : articles.length === 0 ? (
        <p className="text-muted">
          Pas encore d'article — importe une page japonaise ci-dessous (URL ou texte collé).
        </p>
      ) : (
        <div className="flex flex-col">
          {articles.map((a) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              className="flex cursor-pointer flex-col border-t border-hairline py-4 last:border-b"
              onClick={() => onOpen(a)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(a);
              }}
              aria-label="Ouvrir l'article"
            >
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="font-jp text-lg">{a.title}</span>
                  <span className="text-sm text-muted">
                    {new Date(a.createdAt).toLocaleString("fr-FR")}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <ReadabilityBadge text={a.text} />
                    {a.source?.siteName && <Badge>{a.source.siteName}</Badge>}
                    {a.params.level && <Badge>≈ N{a.params.level}</Badge>}
                  </div>
                </div>
                <span className="shrink-0 self-center text-muted">
                  <IconArrowRight size={16} />
                </span>
              </div>
              <div className="-mb-2 flex items-center justify-end gap-1">
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label="Supprimer l'article"
                  title="Supprimer l'article"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Supprimer cet article ?")) void remove(a.id);
                  }}
                >
                  <IconClose size={16} />
                </Button>
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label={
                    podcast.activeStoryId === a.id && podcast.playing
                      ? "Mettre en pause"
                      : "Écouter l'article"
                  }
                  title={
                    podcast.activeStoryId === a.id && podcast.playing
                      ? "Mettre en pause"
                      : "Écouter l'article"
                  }
                  className={podcast.activeStoryId === a.id && podcast.playing ? "text-accent" : ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (podcast.activeStoryId === a.id) podcast.toggle();
                    else podcast.playStory({ storyId: a.id, title: a.titleFr ?? a.title });
                  }}
                >
                  {podcast.activeStoryId === a.id && podcast.playing ? (
                    <IconPause size={16} />
                  ) : (
                    <IconPlay size={16} />
                  )}
                </Button>
                <DownloadButton target={{ kind: "story", storyId: a.id }} size={16} />
              </div>
            </div>
          ))}
        </div>
      )}

      <ArticleImportPanel onImported={onOpen} />
    </div>
  );
}

/**
 * Import d'un article : par URL (fetch via le proxy Worker + extraction « mode lecture »)
 * ou par texte collé — deux actions au même niveau, pas un repli l'une de l'autre.
 */
function ArticleImportPanel({ onImported }: { onImported: (article: StoryRecord) => void }) {
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<StoryRecord>) {
    setError(null);
    setImporting(true);
    try {
      onImported(await action());
    } catch (e) {
      setError(e instanceof ArticleImportError ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel>Importer un article</SectionLabel>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex grow basis-48 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="a-url">
            Adresse de l'article
          </label>
          <input
            className="h-11 rounded-sm border border-hairline bg-bg p-2 text-text"
            id="a-url"
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://www3.nhk.or.jp/news/easy/…"
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          onClick={() => void run(() => importArticleFromUrl(url.trim()))}
          disabled={importing || !url.trim()}
        >
          {importing ? "Import…" : "Importer"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-hairline pt-3">
        <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="a-paste">
          Ou colle le texte de l'article
        </label>
        <textarea
          className="min-h-[4.5rem] w-full resize-y rounded-sm border border-hairline bg-bg p-3 font-jp text-lg leading-[1.8] text-text"
          id="a-paste"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          spellCheck={false}
          placeholder="Colle ici le contenu d'un article japonais…"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void run(() => saveArticle({ text: paste }))}
            disabled={importing || !paste.trim()}
          >
            Lire ce texte
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}
    </Card>
  );
}
