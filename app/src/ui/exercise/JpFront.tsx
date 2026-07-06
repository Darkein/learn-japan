/** Face avant japonaise, avec soulignement du mot cible (écoute en contexte). */
export function JpFront({
  text,
  underline,
  className,
}: {
  text: string;
  underline?: string;
  className?: string;
}) {
  const i = underline ? text.indexOf(underline) : -1;
  return (
    <div className={className}>
      {!underline || i < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, i)}
          <span className="underline decoration-accent decoration-2 underline-offset-4">
            {text.slice(i, i + underline.length)}
          </span>
          {text.slice(i + underline.length)}
        </>
      )}
    </div>
  );
}
