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

export function enqueue(item) {
  const queue = getQueue();
  queue.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
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
