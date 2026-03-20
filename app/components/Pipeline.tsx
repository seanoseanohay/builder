"use client";

import { useCallback, useState } from "react";
import JSZip from "jszip";
import { getStoredOpenRouterKey, setStoredOpenRouterKey } from "@/lib/api";
import {
  DEFAULT_POLICY,
  type PipelineState,
  type PipelineIntake,
  type PipelinePolicy,
} from "@/lib/pipeline-types";

const initialIntake: PipelineIntake = {
  company: "",
  website: "",
  projectName: "",
  problemStatement: "",
  functionalReqs: "",
  languages: "",
  status: "ACTIVE",
  additionalNotes: "",
};

export default function Pipeline() {
  const [intake, setIntake] = useState(initialIntake);
  const [policy, setPolicy] = useState<PipelinePolicy>(DEFAULT_POLICY);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [humanAnswer, setHumanAnswer] = useState("");

  const apiKey = openRouterKey.trim() || getStoredOpenRouterKey();

  const runStep = useCallback(
    async (currentState: PipelineState, humanAnswerOverride?: string) => {
      const res = await fetch("/api/pipeline/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: currentState,
          policy: {
            consensusThresholdPercent: policy.consensusThresholdPercent,
            consensusModelCount: policy.consensusModelCount,
            consensusMaxModels: policy.consensusMaxModels,
          },
          humanAnswer: humanAnswerOverride ?? (currentState.humanGate ? humanAnswer : undefined),
          openRouterApiKey: apiKey || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { state: PipelineState; manifest?: { files: string[]; summary?: string } };
      setState(data.state);
      return data;
    },
    [policy, humanAnswer, apiKey],
  );

  const startPipeline = useCallback(async () => {
    if (!apiKey) {
      setError("OpenRouter API key required. Add it above.");
      return;
    }
    if (!intake.company.trim() || !intake.problemStatement.trim() || !intake.functionalReqs.trim()) {
      setError("Fill in at least Company, Problem statement, and Functional requirements.");
      return;
    }
    setError(null);
    setLoading(true);
    setHumanAnswer("");
    try {
      const initialState: PipelineState = {
        stage: "intake",
        intake: {
          ...intake,
          company: intake.company.trim(),
          projectName: intake.projectName.trim() || intake.company.trim(),
          problemStatement: intake.problemStatement.trim(),
          functionalReqs: intake.functionalReqs.trim(),
          website: intake.website.trim(),
          languages: intake.languages?.trim(),
          status: intake.status || "ACTIVE",
          additionalNotes: intake.additionalNotes?.trim(),
        },
        decisionLog: [],
      };
      await runStep(initialState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [intake, apiKey, runStep]);

  const continuePipeline = useCallback(async () => {
    if (!state) return;
    setError(null);
    setLoading(true);
    try {
      await runStep(state, state.humanGate ? humanAnswer : undefined);
      setHumanAnswer("");
      if (state.humanGate) setHumanAnswer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [state, humanAnswer, runStep]);

  const runNextStep = useCallback(async () => {
    let current: PipelineState | null = state;
    if (!current) return;
    setError(null);
    setLoading(true);
    try {
      while (current) {
        const data = await runStep(current);
        const nextState = data.state as PipelineState;
        setState(nextState);
        if (nextState.humanGate || nextState.stage === "finished" || nextState.error) break;
        current = nextState;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [state, runStep]);

  const downloadDistilledZip = useCallback(() => {
    if (!state?.distilledDocs?.length) return;
    const zip = new JSZip();
    const inDocs = new Set(["requirements.md", "scope.md", "phases.md", "architecture.md", "decisions.md", "system-map.md", "constraints.md"]);
    for (const f of state.distilledDocs) {
      const path = inDocs.has(f.name) ? `docs/${f.name}` : f.name;
      zip.file(path, f.content);
    }
    zip.generateAsync({ type: "blob" }).then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "project-docs.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }, [state?.distilledDocs]);

  const saveOpenRouterKey = () => {
    if (openRouterKey.trim()) {
      setStoredOpenRouterKey(openRouterKey.trim());
    }
  };

  return (
    <div className="container">
      <header>
        <div className="header-tag">{"// cursor + claude code workflow"}</div>
        <h1>Project Kickstarter</h1>
        <p className="subtitle">
          Brief → Research → Layers → SDS (consensus) → PRD → Plan → Refined → Distilled → Build. Human only when consensus is below threshold.
        </p>
      </header>

      <section className="pipeline-section">
        <h2 className="section-title">OpenRouter API key</h2>
        <p className="section-desc">One key for all models. Stored in this browser only.</p>
        <div className="pipeline-key-row">
          <input
            type="password"
            value={openRouterKey}
            onChange={(e) => setOpenRouterKey(e.target.value)}
            placeholder={getStoredOpenRouterKey() ? "••••••••" : "sk-or-..."}
            className="api-key-input"
          />
          <button type="button" onClick={saveOpenRouterKey} className="btn btn-secondary">
            Save
          </button>
        </div>
      </section>

      <section className="pipeline-section">
        <h2 className="section-title">Policy</h2>
        <p className="section-desc">Consensus threshold: above = auto-pick; below = ask human.</p>
        <div className="pipeline-policy">
          <label className="pipeline-policy-label">
            <span>Consensus threshold</span>
            <span className="pipeline-policy-value">{policy.consensusThresholdPercent}%</span>
          </label>
          <input
            type="range"
            min={50}
            max={100}
            value={policy.consensusThresholdPercent}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, consensusThresholdPercent: Number(e.target.value) }))
            }
            className="pipeline-slider"
          />
          <label className="field-group pipeline-models-row">
            <span className="pipeline-policy-label-inline">Models for consensus</span>
            <input
              type="number"
              min={3}
              max={5}
              value={policy.consensusModelCount}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, consensusModelCount: Number(e.target.value) || 3 }))
              }
              className="pipeline-number"
            />
          </label>
        </div>
      </section>

      <section className="pipeline-section">
        <h2 className="section-title">Input (brief)</h2>
        <p className="section-desc">Company and project brief. Pipeline runs research, layers, SDS (with consensus), then PRD, plan, refiner, projgen, and builder.</p>
        <div className="pipeline-inputs">
          <div className="field-group">
            <label>Company name</label>
            <input
              type="text"
              value={intake.company}
              onChange={(e) => setIntake((i) => ({ ...i, company: e.target.value }))}
              placeholder="Acme Inc"
            />
          </div>
          <div className="field-group">
            <label>Company website</label>
            <input
              type="text"
              value={intake.website}
              onChange={(e) => setIntake((i) => ({ ...i, website: e.target.value }))}
              placeholder="https://acme.com"
            />
          </div>
          <div className="field-group">
            <label>Project name</label>
            <input
              type="text"
              value={intake.projectName}
              onChange={(e) => setIntake((i) => ({ ...i, projectName: e.target.value }))}
              placeholder="Project name or leave blank to use company"
            />
          </div>
          <div className="field-group">
            <label>Problem statement</label>
            <textarea
              value={intake.problemStatement}
              onChange={(e) => setIntake((i) => ({ ...i, problemStatement: e.target.value }))}
              rows={3}
              placeholder="What problem does this solve?"
            />
          </div>
          <div className="field-group">
            <label>Functional requirements</label>
            <textarea
              value={intake.functionalReqs}
              onChange={(e) => setIntake((i) => ({ ...i, functionalReqs: e.target.value }))}
              rows={5}
              placeholder="List key features and requirements"
            />
          </div>
          <div className="field-group">
            <label>Required languages / stack</label>
            <input
              type="text"
              value={intake.languages ?? ""}
              onChange={(e) => setIntake((i) => ({ ...i, languages: e.target.value }))}
              placeholder="e.g. TypeScript, React, Node"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="alert alert-warning">{error}</div>
      )}

      <div className="btn-row">
        {!state ? (
          <button
            type="button"
            onClick={startPipeline}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? "Running…" : "Run pipeline"}
          </button>
        ) : state.humanGate ? (
          <div className="pipeline-human-gate">
            <h3 className="section-title">Human input needed ({state.humanGate.stage})</h3>
            <p className="pipeline-human-question">{state.humanGate.question}</p>
            {state.humanGate.context && (
              <p className="pipeline-human-context">{state.humanGate.context}</p>
            )}
            <div className="pipeline-options">
              {state.humanGate.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setHumanAnswer(opt)}
                  className={`btn btn-secondary pipeline-option-btn ${humanAnswer === opt ? "pipeline-option-selected" : ""}`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="field-group">
              <input
                type="text"
                value={humanAnswer}
                onChange={(e) => setHumanAnswer(e.target.value)}
                placeholder="Or type custom answer"
              />
            </div>
            <button
              type="button"
              onClick={continuePipeline}
              disabled={loading || !humanAnswer.trim()}
              className="btn btn-primary"
            >
              {loading ? "Sending…" : "Submit and continue"}
            </button>
          </div>
        ) : state.stage === "finished" ? (
          <div className="pipeline-finished">
            <h3 className="section-title">Pipeline finished</h3>
            {state.outputPath && (
              <p className="pipeline-output-path">Workspace: {state.outputPath}</p>
            )}
            {state.distilledDocs?.length ? (
              <button
                type="button"
                onClick={downloadDistilledZip}
                className="btn btn-success"
              >
                Download distilled docs (ZIP)
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={runNextStep}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? "Running…" : "Next step"}
          </button>
        )}
      </div>

      {state && (
        <section className="output-card pipeline-progress">
          <div className="output-card-header">
            <span className="card-title">Progress</span>
          </div>
          <div className="output-card-body open">
            <p className="pipeline-stage">
              Stage: <strong>{state.stage}</strong>
              {state.error && <span className="pipeline-error"> — {state.error}</span>}
            </p>
            {state.decisionLog?.length ? (
              <ul className="pipeline-decision-log">
                {state.decisionLog.map((d, i) => (
                  <li key={i}>
                    [{d.stage}] {d.question && `${d.question.slice(0, 50)}…`}
                    {d.consensusPercent != null && ` ${d.consensusPercent}%`}
                    {d.chosenAnswer && ` → ${d.chosenAnswer.slice(0, 35)}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
