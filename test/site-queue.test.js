import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  getQueue,
  enqueue,
  removeAt,
  clear,
  isBatchMode,
  setBatchMode,
  onQueueChange,
} from "../site/queue.js";
import { link } from "./fixtures.js";

function fakeLocalStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const addItem = (id) => ({ type: "add", fields: { link: link(id) }, label: `add ${id}` });

describe("site/queue", () => {
  let storage;

  before(() => {
    assert.equal(globalThis.localStorage, undefined, "these tests assume no real localStorage");
  });

  beforeEach(() => {
    storage = fakeLocalStorage();
    globalThis.localStorage = storage;
  });

  after(() => {
    delete globalThis.localStorage;
  });

  test("starts empty and keeps what is enqueued", () => {
    assert.deepEqual(getQueue(), []);
    assert.equal(enqueue(addItem(1)), false);
    assert.equal(enqueue(addItem(2)), false);
    assert.deepEqual(getQueue().map((i) => i.label), ["add 1", "add 2"]);
  });

  test("replaces an operation that targets the same thing and says so", () => {
    enqueue({ type: "add", fields: { link: link(1) }, label: "primera" });
    assert.equal(enqueue({ type: "add", fields: { link: link(1) }, label: "segunda" }), true);
    assert.deepEqual(getQueue().map((i) => i.label), ["segunda"]);
  });

  test("tells apart the target of each operation type", () => {
    enqueue({ type: "fix", fields: { old_link: link(1) }, label: "fix" });
    enqueue({ type: "poster", fields: { tmdb: "https://www.themoviedb.org/movie/550" }, label: "poster" });
    enqueue({ type: "reidentify", fields: { old_link: link(1) }, label: "reid link" });
    enqueue({ type: "reidentify", fields: { tmdb: "https://www.themoviedb.org/movie/550" }, label: "reid title" });
    enqueue({ type: "add", fields: { link: link(1) }, label: "add" });
    assert.deepEqual(getQueue().map((i) => i.label), ["fix", "poster", "reid link", "reid title", "add"]);
  });

  test("a reidentify without old_link is keyed by its tmdb value", () => {
    enqueue({ type: "reidentify", fields: { tmdb: "https://www.themoviedb.org/movie/550" }, label: "primera" });
    assert.equal(
      enqueue({ type: "reidentify", fields: { tmdb: "https://www.themoviedb.org/movie/550" }, label: "segunda" }),
      true
    );
    assert.equal(getQueue().length, 1);
  });

  test("removeAt drops one item by index", () => {
    enqueue(addItem(1));
    enqueue(addItem(2));
    removeAt(0);
    assert.deepEqual(getQueue().map((i) => i.label), ["add 2"]);
  });

  test("clear empties the queue", () => {
    enqueue(addItem(1));
    clear();
    assert.deepEqual(getQueue(), []);
  });

  test("survives a corrupt stored value", () => {
    storage.setItem("cositeca:batchQueue", "{not json");
    assert.deepEqual(getQueue(), []);
  });

  test("batch mode is off by default and round trips", () => {
    assert.equal(isBatchMode(), false);
    setBatchMode(true);
    assert.equal(isBatchMode(), true);
    setBatchMode(0);
    assert.equal(isBatchMode(), false);
  });

  test("notifies listeners on every change until they unsubscribe", () => {
    let calls = 0;
    const unsubscribe = onQueueChange(() => calls++);
    enqueue(addItem(1));
    removeAt(0);
    clear();
    setBatchMode(true);
    assert.equal(calls, 4);
    unsubscribe();
    enqueue(addItem(2));
    assert.equal(calls, 4);
  });

  test("the stored queue is plain JSON", () => {
    enqueue(addItem(1));
    assert.deepEqual(JSON.parse(storage.getItem("cositeca:batchQueue")), [addItem(1)]);
  });
});
