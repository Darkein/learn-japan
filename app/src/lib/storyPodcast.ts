import type { AnnotatedToken } from "./furigana";
import type { PodcastSegment } from "./podcastScript";
import { splitSentences } from "./tts";

export function buildStorySegments(tokens: AnnotatedToken[], storyId?: string): PodcastSegment[] {
  return splitSentences(tokens).map((s, i) => ({
    id: `story-${i}`,
    chapter: "histoire",
    lang: "ja",
    text: s.text,
    tokens: s.segments,
    baseTokenIndex: s.baseIndex,
    label: s.text.length > 24 ? `${s.text.slice(0, 24)}…` : s.text,
    storyId,
  }));
}
