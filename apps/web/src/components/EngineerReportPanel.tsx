import { useState } from "react";
import type { ComparisonResponse } from "../types";

export function EngineerReportPanel(props: {
  comparison: ComparisonResponse;
}) {
  const { comparison } = props;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(comparison.report.exportMarkdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([comparison.report.exportMarkdown], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${comparison.session.year}-${comparison.session.grandPrix}-${comparison.referenceLap.driver.acronym}-vs-${comparison.targetLap.driver.acronym}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel analysis-panel report-panel">
      <div className="analysis-panel__header">
        <div>
          <p className="hero__eyebrow">Engineer Report</p>
          <h3 className="section-title">Exportable Session Note</h3>
        </div>
        <div className="report-actions">
          <button type="button" className="button-secondary" onClick={() => void handleCopy()}>
            {copied ? "Copied" : "Copy Report"}
          </button>
          <button type="button" onClick={handleDownload}>
            Download Markdown
          </button>
        </div>
      </div>

      <h4 className="report-panel__headline">{comparison.report.headline}</h4>

      <div className="report-summary">
        {comparison.report.summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <div className="report-grid">
        <article className="report-card">
          <h5>Strongest Sectors</h5>
          <ul className="report-list">
            {comparison.report.strongestSectors.map((item) => (
              <li key={item.label}>{item.note}</li>
            ))}
          </ul>
        </article>

        <article className="report-card">
          <h5>Biggest Time Swings</h5>
          <ul className="report-list">
            {comparison.report.biggestLosses.map((item) => (
              <li key={item.label}>{item.note}</li>
            ))}
          </ul>
        </article>

        <article className="report-card">
          <h5>Tyre Notes</h5>
          <ul className="report-list">
            {comparison.report.tyreNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="report-card">
          <h5>Brake Notes</h5>
          <ul className="report-list">
            {comparison.report.brakeNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
