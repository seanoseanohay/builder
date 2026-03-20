"use client";

import { useCallback, useState } from "react";
import JSZip from "jszip";
import { getStoredOpenRouterKey, setStoredOpenRouterKey } from "@/lib/api";
import {
  DEFAULT_POLICY,
  type PipelineState,
  type PipelineInput,
  type PipelinePolicy,
} from "@/lib/pipeline-types";
import Link from "next/link";

const initialInput: PipelineInput = {
  plan: "",
  requirements: "",
  prd: "",
  research: "",
};

export default function PipelinePage() {
  const [input, setInput] = useState(initialInput);
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
    if (!input.plan.trim() || !input.requirements.trim() || !input.prd.trim() || !input.research.trim()) {
      setError("Fill in all four inputs: Plan, Requirements, PRD, Research.");
      return;
    }
    setError(null);
    setLoading(true);
    setHumanAnswer("");
    try {
      const initialState: PipelineState = {
        stage: "refiner",
        input,
        decisionLog: [],
      };
      await runStep(initialState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [input, apiKey, runStep]);

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
        <div className="header-tag">{"// openrouter pipeline"}</div>
        <div className="pipeline-header-row">
          <Link href="/" className="pipeline-back">← Wizard</Link>
          <h1>Pipeline</h1>
        </div>
        <p className="subtitle">
          Documents → Refined → Distilled → Build. Consensus over 3–5 models; human only when below threshold.
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
        <h2 className="section-title">Input documents</h2>
        <p className="section-desc">Paste plan, requirements, PRD, and research.</p>
        <div className="pipeline-inputs">
          {(["plan", "requirements", "prd", "research"] as const).map((key) => (
            <div key={key} className="field-group">
              <label>{key}</label>
              <textarea
                value={input[key]}
                onChange={(e) => setInput((i) => ({ ...i, [key]: e.target.value }))}
                rows={5}
              />
            </div>
          ))}
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