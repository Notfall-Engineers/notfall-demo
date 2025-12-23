// src/services/TaskStream.js
const listeners = new Set();

/**
 * Called by routes to subscribe Task Inbox widgets.
 * Here we just store callbacks; in real system you might use WebSocket or Redis pub/sub.
 */
export function subscribeTaskStream(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitTaskEvent(evt) {
  for (const fn of listeners) {
    try {
      fn(evt);
    } catch (e) {
      console.error("TaskStream listener failed", e);
    }
  }
}
