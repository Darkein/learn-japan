export type PlayMode = "auto" | "repeat" | "once";

export type QueueItem =
  | { kind: "lesson"; lessonId: string; title: string }
  | { kind: "story"; storyId: string; title: string };

export type EndAction = "advance" | "loop" | "append" | "stop";

export function reorder<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function endAction(mode: PlayMode, hasNextInQueue: boolean): EndAction {
  if (hasNextInQueue) return "advance";
  if (mode === "repeat") return "loop";
  if (mode === "auto") return "append";
  return "stop";
}

export function nextMode(m: PlayMode): PlayMode {
  return m === "auto" ? "repeat" : m === "repeat" ? "once" : "auto";
}
