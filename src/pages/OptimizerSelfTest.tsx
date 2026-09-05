import { Button, Card, CardBody, Chip, Progress } from "@heroui/react";
import { useState } from "react";
import Container from "../components/Container";
import { FIXTURES } from "../dev/optimizerFixtures";
import { describeDrift } from "../dev/optimizerBaseline";
import {
  baselineSource,
  runSelfTest,
  SIZES,
  type Report,
} from "../dev/optimizerSelfTest";

/**
 * Development-only page.
 *
 * It answers two separate questions, and a row has to clear both. "changed" is
 * how far the output drifted from the *input* - did the picture survive.
 * "drift" is how far it moved from the *last recorded run* - did anything
 * change that you did not mean to change. A refactor can leave the first
 * spotless while breaking the second.
 */
export default function OptimizerSelfTest() {
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1, label: "" });

  const run = async () => {
    setRunning(true);
    setReport(null);
    setCopied(false);
    try {
      const result = await runSelfTest((done, total, label) =>
        setProgress({ done, total, label })
      );
      setReport(result);
      (window as unknown as { __selftest?: Report }).__selftest = result;
    } finally {
      setRunning(false);
    }
  };

  const copyBaseline = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(baselineSource(report));
    setCopied(true);
  };

  const pct = (n: number) => n.toFixed(3) + "%";
  const delta = (before: number, after: number) =>
    before === 0 ? "-" : ((100 * (after - before)) / before).toFixed(1) + "%";

  return (
    <Container className="py-12">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Optimizer self-test</h1>
          <p className="text-sm text-foreground/60">
            {FIXTURES.length} fixtures &times; 4 engines, rendered before and
            after at {SIZES.join(", ")} px.
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <Button variant="flat" onPress={copyBaseline}>
              {copied ? "Copied" : "Copy baseline"}
            </Button>
          )}
          <Button color="primary" onPress={run} isLoading={running}>
            {running ? "Running" : "Run"}
          </Button>
        </div>
      </div>

      {running && (
        <div className="mb-6">
          <Progress
            aria-label="progress"
            value={(100 * progress.done) / progress.total}
          />
          <p className="text-xs text-foreground/50 mt-1">{progress.label}</p>
        </div>
      )}

      {report && (
        <Card>
          <CardBody className="overflow-x-auto">
            <div className="flex gap-2 mb-4 flex-wrap">
              <Chip color={report.failed ? "danger" : "success"} variant="flat">
                {report.passed} passed, {report.failed} failed
              </Chip>
              {report.drifted > 0 && (
                <Chip color="warning" variant="flat">
                  {report.drifted} drifted from the baseline
                </Chip>
              )}
              <Chip variant="flat">{report.ms} ms</Chip>
            </div>
            <table className="text-xs font-mono w-full">
              <thead className="text-foreground/50 text-left">
                <tr>
                  <th className="pr-4 py-1">fixture</th>
                  <th className="pr-4">engine</th>
                  <th className="pr-4 text-right">ms</th>
                  <th className="pr-4 text-right">raw</th>
                  <th className="pr-4 text-right">gzip</th>
                  <th className="pr-4 text-right">changed</th>
                  <th className="pr-4 text-right">allowed</th>
                  <th className="pr-4 text-right">max&Delta;</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => (
                  <tr
                    key={r.fixture + r.engine}
                    className="border-t border-foreground/10"
                  >
                    <td className="pr-4 py-1">{r.fixture}</td>
                    <td className="pr-4">{r.engine}</td>
                    <td className="pr-4 text-right">{r.ms}</td>
                    <td className="pr-4 text-right">
                      {delta(r.rawIn, r.rawOut)}
                    </td>
                    <td className="pr-4 text-right">
                      {delta(r.gzipIn, r.gzipOut)}
                    </td>
                    <td className="pr-4 text-right">{pct(r.pctChanged)}</td>
                    <td className="pr-4 text-right text-foreground/40">
                      {pct(r.tolerance)}
                    </td>
                    <td className="pr-4 text-right text-foreground/40">
                      {r.maxDelta}
                    </td>
                    <td>
                      {r.error ? (
                        <span className="text-danger">{r.error}</span>
                      ) : r.pass ? (
                        <span className="text-success">pass</span>
                      ) : r.drift.length > 0 &&
                        r.pctChanged <= r.tolerance ? (
                        // The picture is fine; something moved since the
                        // baseline. Read the reason and either accept it with
                        // "Copy baseline" or treat it as a regression.
                        <span className="text-warning">
                          {r.drift.map(describeDrift).join("; ")}
                        </span>
                      ) : (
                        <span className="text-danger">FAIL</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <div className="mt-8 text-xs text-foreground/50 space-y-2">
        <p>
          A fixture with a non-zero allowance has a structural difference that
          is understood and recorded:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          {FIXTURES.filter((f) => f.why).map((f) => (
            <li key={f.name}>
              <span className="font-mono">{f.name}</span> &mdash; {f.why}
            </li>
          ))}
        </ul>
      </div>
    </Container>
  );
}
