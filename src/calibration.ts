import type { Finding } from "./types.js";

export type FindingLabel = { kind: string; file: string };
export type FindingLabels = { positives: FindingLabel[]; negatives: FindingLabel[] };

// These are file/rule-pair scores on explicitly labeled cases, not estimates of
// real-world accuracy. Unlabeled findings are neither successes nor failures.
export function scoreLabeledFindings(expected: FindingLabels, findings: Finding[]) {
  const key = (label: FindingLabel) => `${label.kind}\u0000${label.file}`;
  const actual = new Set(findings.flatMap((finding) => finding.file && !finding.suppressed ? [key({ kind: finding.kind, file: finding.file })] : []));
  const labeled = new Set([...expected.positives, ...expected.negatives].map(key));
  const kinds = [...new Set([...expected.positives, ...expected.negatives].map((label) => label.kind))].sort();
  const scores = kinds.map((kind) => {
    const positives = expected.positives.filter((label) => label.kind === kind);
    const negatives = expected.negatives.filter((label) => label.kind === kind);
    const truePositives = positives.filter((label) => actual.has(key(label))).length;
    const falseNegatives = positives.length - truePositives;
    const falsePositives = negatives.filter((label) => actual.has(key(label))).length;
    return {
      kind, true_positives: truePositives, false_positives: falsePositives, false_negatives: falseNegatives,
      true_negatives: negatives.length - falsePositives,
      precision: ratio(truePositives, truePositives + falsePositives),
      recall: ratio(truePositives, truePositives + falseNegatives),
    };
  });
  return {
    scope: "explicitly labeled file/rule pairs only",
    labels: { positives: expected.positives.length, negatives: expected.negatives.length },
    scores,
    missing: expected.positives.filter((label) => !actual.has(key(label))),
    unexpected: expected.negatives.filter((label) => actual.has(key(label))),
    unlabeled_findings: [...actual].filter((item) => !labeled.has(item)).length,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(3)) : null;
}
