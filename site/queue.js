const QUEUE_KEY = "cositeca:batchQueue";
const MODE_KEY = "cositeca:batchMode";
const listeners = new Set();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function notify() {
  for (const fn of listeners) fn();
}

export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getQueue() {
  return read(QUEUE_KEY, []);
}

function targetKey({ type, fields }) {
  if (type === "fix") return `fix:${fields.old_link}`;
  if (type === "poster") return `poster:${fields.tmdb}`;
  return `add:${fields.link}`;
}

export function enqueue(item) {
  const queue = getQueue();
  const existing = queue.findIndex((queued) => targetKey(queued) === targetKey(item));
  if (existing === -1) queue.push(item);
  else queue[existing] = item;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
  return existing !== -1;
}

export function removeAt(index) {
  const queue = getQueue();
  queue.splice(index, 1);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
}

export function clear() {
  localStorage.removeItem(QUEUE_KEY);
  notify();
}

export function isBatchMode() {
  return read(MODE_KEY, false);
}

export function setBatchMode(value) {
  localStorage.setItem(MODE_KEY, JSON.stringify(Boolean(value)));
  notify();
}
