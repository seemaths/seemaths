// Only numeric question outcomes leave the browser, never answer text.
export function questionOutcomes(attempt, tracking = {}) {
  const final = attempt.result?.answers;
  return Array.from({length:attempt.recipe.count}, (_, index) => {
    const answer = final ? final.find(a => a.index === index+1) : attempt.state?.answers?.[index];
    const detail = tracking[index] || {};
    const hasValue = String(answer?.value ?? '').trim().length > 0;
    const correct = final ? (hasValue ? Boolean(answer.correct) : null) : hasValue && answer?.checked ? Boolean(answer.correct) : null;
    const checks = Math.min(999, Math.max(detail.checks || 0, answer?.checked ? 1 : 0));
    const skipped = correct === true ? false : Boolean(detail.skipped);
    return hasValue || checks || detail.helped || skipped
      ? {index:index+1, correct, checks, helped:Boolean(detail.helped), skipped}
      : null;
  }).filter(Boolean);
}
