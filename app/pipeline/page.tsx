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
    <div className="min-h-screen p-6 max-w-4xl mx-auto font-sans">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-blue-600 hover:underline">← Wizard</Link>
        <h1 className="text-2xl font-bold">Pipeline: Documents → Refined → Distilled → Build</h1>
      </div>

      <p className="text-gray-600 mb-4">
        Drop in your plan, requirements, PRD, and research. The pipeline runs Refiner (consensus over 3–5 models),
        then Projgen, then Builder (Claude Code headless). Human is only asked when consensus is below the threshold.
      </p>

      {/* OpenRouter key */}
      <section className="mb-6 p-4 border rounded bg-gray-50">
        <label className="block font-medium mb-2">OpenRouter API key</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={openRouterKey}
            onChange={(e) => setOpenRouterKey(e.target.value)}
            placeholder={getStoredOpenRouterKey() ? "••••••••" : "sk-or-..."}
            className="flex-1 border rounded px-3 py-2"
          />
          <button type="button" onClick={saveOpenRouterKey} className="px-4 py-2 bg-gray-200 rounded">
            Save
          </button>
        </div>
      </section>

      {/* Policy sliders */}
      <section className="mb-6 p-4 border rounded">
        <h2 className="font-semibold mb-2">Policy</h2>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="w-48">Consensus threshold %</span>
            <input
              type="range"
              min={50}
              max={100}
              value={policy.consensusThresholdPercent}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, consensusThresholdPercent: Number(e.target.value) }))
              }
            />
            <span>{policy.consensusThresholdPercent}%</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-48">Models for consensus</span>
            <input
              type="number"
              min={3}
              max={5}
              value={policy.consensusModelCount}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, consensusModelCount: Number(e.target.value) || 3 }))
              }
            />
          </label>
        </div>
      </section>

      {/* Inputs */}
      <section className="mb-6 grid gap-4">
        {(["plan", "requirements", "prd", "research"] as const).map((key) => (
          <div key={key}>
            <label className="block font-medium mb-1 capitalize">{key}</label>
            <textarea
              value={input[key]}
              onChange={(e) => setInput((i) => ({ ...i, [key]: e.target.value }))}
              rows={6}
              className="w-full border rounded p-2 font-mono text-sm"
            />
          </div>
        ))}
      </section>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-100 text-red-800">{error}</div>
      )}

      {/* Run / Continue */}
      {!state ? (
        <button
          type="button"
          onClick={startPipeline}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Run pipeline"}
        </button>
      ) : state.humanGate ? (
        <section className="mb-6 p-4 border rounded bg-amber-50">
          <h3 className="font-semibold mb-2">Human input needed ({state.humanGate.stage})</h3>
          <p className="mb-2">{state.humanGate.question}</p>
          {state.humanGate.context && (
            <p className="text-sm text-gray-600 mb-2">{state.humanGate.context}</p>
          )}
          <div className="flex flex-wrap gap-2 mb-2">
            {state.humanGate.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setHumanAnswer(opt)}
                className="px-3 py-1 border rounded bg-white"
              >
                {opt}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={humanAnswer}
            onChange={(e) => setHumanAnswer(e.target.value)}
            placeholder="Or type custom answer"
            className="w-full border rounded px-3 py-2 mb-2"
          />
          <button
            type="button"
            onClick={continuePipeline}
            disabled={loading || !humanAnswer.trim()}
            className="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-50"
          >
            {loading ? "Sending…" : "Submit and continue"}
          </button>
        </section>
      ) : state.stage === "finished" ? (
        <section className="mb-6 p-4 border rounded bg-green-50">
          <h3 className="font-semibold text-green-800">Pipeline finished</h3>
          {state.outputPath && (
            <p className="text-sm text-gray-600 mt-1">
              Builder workspace: {state.outputPath} (server path)
            </p>
          )}
          {state.distilledDocs?.length ? (
            <button
              type="button"
              onClick={downloadDistilledZip}
              className="mt-2 px-4 py-2 bg-green-600 text-white rounded"
            >
              Download distilled docs (ZIP)
            </button>
          ) : null}
        </section>
      ) : (
        <button
          type="button"
          onClick={runNextStep}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Next step"}
        </button>
      )}

      {/* Progress */}
      {state && (
        <section className="mt-6 p-4 border rounded">
          <h3 className="font-semibold mb-2">Progress</h3>
          <p>
            Stage: <strong>{state.stage}</strong>
            {state.error && <span className="text-red-600 ml-2">{state.error}</span>}
          </p>
          {state.decisionLog?.length ? (
            <ul className="mt-2 text-sm space-y-1">
              {state.decisionLog.map((d, i) => (
                <li key={i}>
                  [{d.stage}] {d.question && `Q: ${d.question.slice(0, 60)}…`}
                  {d.consensusPercent != null && ` ${d.consensusPercent}%`}
                  {d.chosenAnswer && ` → ${d.chosenAnswer.slice(0, 40)}`}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}