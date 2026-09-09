// Serialize imports and comparisons for one session so reimports cannot race
// with telemetry writes or repopulate the cache with an older snapshot.
const pending = new Map<number, Promise<unknown>>();

export function runSessionTask<T>(
  sessionKey: number,
  work: () => Promise<T>,
): Promise<T> {
  const previous = pending.get(sessionKey) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  pending.set(sessionKey, task);
  const cleanup = () => {
    if (pending.get(sessionKey) === task) pending.delete(sessionKey);
  };
  task.then(cleanup, cleanup);
  return task;
}
