/** Import from the See Maths player; secrets stay in the parent portal, never here. */
export function assignmentBridge({
  allowedPortalOrigins = ["https://seemaths.org"],
} = {}) {
  const parameters = new URLSearchParams(location.search);
  const assignmentId = parameters.get("assignment");
  const portalOrigin = parameters.get("portalOrigin");
  if (
    !assignmentId ||
    !/^[0-9a-f-]{36}$/i.test(assignmentId) ||
    window.parent === window
  )
    return { report() {} };
  let origin;
  try {
    origin = new URL(portalOrigin).origin;
  } catch {
    return { report() {} };
  }
  if (!allowedPortalOrigins.includes(origin)) return { report() {} };
  const send = (data) =>
    window.parent.postMessage(
      { protocol: "seemaths.assignments.v1", assignmentId, ...data },
      origin,
    );
  send({ type: "ready" });
  let signature = "";
  return {
    report(attempt) {
      if (!attempt?.id || !attempt?.recipe) return;
      const count = attempt.recipe.count;
      const finalAnswers = attempt.result?.answers;
      const stateAnswers = attempt.state?.answers || [];
      const answers = finalAnswers
        ? finalAnswers
            .filter((a) => String(a.value ?? "").trim())
            .map((a) => ({ index: a.index, correct: Boolean(a.correct) }))
        : stateAnswers.flatMap((a, index) =>
            String(a?.value ?? "").trim()
              ? [
                  {
                    index: index + 1,
                    correct: a.checked ? Boolean(a.correct) : null,
                  },
                ]
              : [],
          );
      const completed =
        Boolean(attempt.result) ||
        (attempt.recipe.mode === "practice" &&
          answers.length === count &&
          answers.every((a) => a.correct !== null));
      const payload = {
        type: "progress",
        attemptId: attempt.id,
        answers,
        completed,
      };
      const next = JSON.stringify(payload);
      if (next !== signature) {
        signature = next;
        send(payload);
      }
    },
  };
}
