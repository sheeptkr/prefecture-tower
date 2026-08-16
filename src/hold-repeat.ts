const initialRepeatDelayMs = 280;
const repeatIntervalMs = 90;

export function beginRepeatedAction(action: () => void, repeat: boolean): () => void {
  action();
  if (!repeat) return () => undefined;

  let stopped = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  const timeoutId = setTimeout(() => {
    if (stopped) return;
    action();
    intervalId = setInterval(action, repeatIntervalMs);
  }, initialRepeatDelayMs);

  return () => {
    stopped = true;
    clearTimeout(timeoutId);
    if (intervalId !== undefined) clearInterval(intervalId);
  };
}
