import { NextRequest, NextResponse } from "next/server";
import { runRefinerStep } from "@/lib/refiner-stage";
import { runProjgenStep } from "@/lib/projgen-stage";
import { runBuilderStage, listWorkspaceFiles } from "@/lib/builder-stage";
import {
  DEFAULT_POLICY,
  type PipelineState,
  type PipelineInput,
  type PipelinePolicy,
} from "@/lib/pipeline-types";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: {
    state: PipelineState;
    policy?: Partial<PipelinePolicy>;
    humanAnswer?: string | null;
    openRouterApiKey?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    state: incomingState,
    policy: policyOverride,
    humanAnswer,
    openRouterApiKey,
  } = body;

  const policy = { ...DEFAULT_POLICY, ...policyOverride };
  const apiKey = openRouterApiKey?.trim() || undefined;

  let state: PipelineState = {
    ...incomingState,
    decisionLog: incomingState.decisionLog ?? [],
  };

  try {
    // Resolve human gate: if we have a human answer, feed it and continue
    if (state.humanGate && humanAnswer != null && humanAnswer.trim() !== "") {
      state = { ...state, humanGate: undefined };
    }

    // Refiner stage
    if (state.stage === "refiner" && state.input) {
      const refinerHistory = state.refinerConversationHistory ?? [];
      const result = await runRefinerStep({
        input: state.input,
        policy,
        conversationHistory: refinerHistory,
        humanAnswer: state.humanGate ? humanAnswer : undefined,
        decisionLog: state.decisionLog,
        apiKey,
      });

      state = {
        ...state,
        refinerConversationHistory: result.conversationHistory,
        decisionLog: result.decisionLog,
        humanGate: result.humanGate,
        ...(result.refinedDocs && {
          refinedDocs: result.refinedDocs,
          stage: "projgen" as const,
        }),
      };

      if (result.humanGate) {
        return NextResponse.json({ state });
      }
      if (result.done && result.refinedDocs) {
        return NextResponse.json({ state });
      }
      // Not done, no human gate → caller should call again with same state (next refiner turn)
      return NextResponse.json({ state });
    }

    // Projgen stage
    if (state.stage === "projgen" && state.refinedDocs) {
      const projgenHistory = state.projgenConversationHistory ?? [];
      const result = await runProjgenStep({
        refinedDocs: state.refinedDocs,
        policy,
        conversationHistory: projgenHistory,
        humanAnswer: state.humanGate ? humanAnswer : undefined,
        decisionLog: state.decisionLog,
        apiKey,
      });

      state = {
        ...state,
        projgenConversationHistory: result.conversationHistory,
        decisionLog: result.decisionLog,
        humanGate: result.humanGate,
        ...(result.distilledDocs && {
          distilledDocs: result.distilledDocs,
          stage: "builder" as const,
        }),
      };

      if (result.humanGate) return NextResponse.json({ state });
      if (result.done && result.distilledDocs) return NextResponse.json({ state });
      return NextResponse.json({ state });
    }

    // Builder stage
    if (state.stage === "builder" && state.distilledDocs?.length) {
      const builderResult = await runBuilderStage({
        distilledDocs: state.distilledDocs,
      });

      if (!builderResult.success) {
        return NextResponse.json({
          state: {
            ...state,
            error: builderResult.error,
            humanGate: {
              stage: "builder",
              question: "Build failed. How do you want to proceed?",
              options: ["Retry", "Download docs only", "Abort"],
              recommendedIndex: 0,
              context: builderResult.error,
            },
          },
        });
      }

      const fileList = listWorkspaceFiles(builderResult.workspacePath);

      return NextResponse.json({
        state: {
          ...state,
          stage: "finished",
          outputPath: builderResult.workspacePath,
          decisionLog: [
            ...state.decisionLog,
            {
              stage: "builder",
              chosenAnswer: builderResult.summary,
            },
          ],
          error: undefined,
        },
        manifest: {
          workspacePath: builderResult.workspacePath,
          files: fileList,
          summary: builderResult.summary,
        },
      });
    }

    return NextResponse.json({ state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      state: {
        ...state,
        error: message,
      },
    }, { status: 500 });
  }
}
