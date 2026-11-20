import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  new URL("../integration/quode-assignment-bridge.js", import.meta.url),
  "utf8",
).replace("export function assignmentBridge", "function assignmentBridge");
const assignmentId = "38341269-2217-43ed-b583-733ff6804ff8";
function fixture(origin = "https://portal.example") {
  const messages = [];
  const context = vm.createContext({
    URL,
    URLSearchParams,
    location: {
      search: `?assignment=${assignmentId}&portalOrigin=${encodeURIComponent(origin)}`,
    },
    window: {
      parent: {
        postMessage: (data, target) => messages.push({ data, target }),
      },
    },
  });
  vm.runInContext(
    source +
      '\nglobalThis.bridge=assignmentBridge({allowedPortalOrigins:["https://portal.example"]});',
    context,
  );
  return { messages, bridge: context.bridge };
}
test("bridge transmits only bounded progress metadata and suppresses identical snapshots", () => {
  const { messages, bridge } = fixture();
  const attempt = {
    id: "ab97ade1-bf03-41a0-907d-f969285e16ec",
    recipe: { count: 3, mode: "exam" },
    state: {
      answers: [
        { value: "private raw answer", checked: false, correct: false },
        { value: "2", checked: true, correct: true },
      ],
    },
  };
  bridge.report(attempt);
  bridge.report(attempt);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].data.type, "ready");
  assert.equal(messages[1].data.answers[0].correct, null);
  assert.equal(messages[1].data.answers[1].correct, true);
  assert.equal(messages[1].target, "https://portal.example");
  assert.equal(messages[1].data.assignmentId, assignmentId);
  assert.equal(JSON.stringify(messages).includes("private raw answer"), false);
  assert.equal(messages[1].data.completed, false);
});
test("unapproved embedding origin receives nothing", () => {
  const { messages, bridge } = fixture("https://unapproved.example");
  bridge.report({
    id: "example",
    recipe: { count: 1, mode: "practice" },
    state: { answers: [{ value: "1", checked: true, correct: true }] },
  });
  assert.equal(messages.length, 0);
});
test("practice completion requires checked answers; exam completion requires a submitted result", () => {
  const { messages, bridge } = fixture();
  const attempt = {
    id: "example",
    recipe: { count: 1, mode: "practice" },
    state: { answers: [{ value: "1", checked: true, correct: false }] },
  };
  bridge.report(attempt);
  assert.equal(messages.at(-1).data.completed, true);
  attempt.recipe.mode = "exam";
  bridge.report(attempt);
  assert.equal(messages.at(-1).data.completed, false);
  attempt.result = { answers: [{ index: 1, value: "1", correct: true }] };
  bridge.report(attempt);
  assert.equal(messages.at(-1).data.completed, true);
});
