import { attachmentToImagePart } from "./vision.js";
import type {
  AgentExecutionResult,
  AgentLoopEvent,
  AgentMessage,
  ExecuteAgentTaskOptions,
  MessageContent,
  TeamExecutionResult,
  TeamExecutionStepResult,
} from "./types.js";
import { createCherryTeamPlan } from "./team.js";

export class AgentLoopLimitError extends Error {
  constructor(public readonly maxSteps: number) {
    super(
      `Cherry agent reached the maximum of ${maxSteps} steps without a final response`,
    );
    this.name = "AgentLoopLimitError";
  }
}

export function buildCherrySystemPrompt(
  agent: ExecuteAgentTaskOptions["agent"],
): string {
  return [
    `You are ${agent.name}, part of the Cherry Agent Team.`,
    `Mission: ${agent.mission}`,
    `Capabilities: ${agent.capabilities.join(", ")}.`,
    "Work in a bounded observe -> decide -> tool -> verify loop.",
    "Use tools only when needed, inspect actual tool results, and stop when the requested outcome is complete.",
    "Never claim a tool action succeeded unless a successful tool result is present.",
    "Request approval for destructive, financial, credential, production, external-publishing, or irreversible actions.",
    "Do not expose private chain-of-thought. Provide concise action summaries and evidence instead.",
    "Return a final result containing outcome, evidence, remaining risk, and the next operational action.",
  ].join("\n");
}

async function buildUserContent(
  options: ExecuteAgentTaskOptions,
): Promise<MessageContent> {
  const text = JSON.stringify(
    {
      task: options.task.objective,
      risk: options.task.risk ?? "medium",
      requiredCapabilities: options.task.requiredCapabilities ?? [],
      metadata: options.task.metadata ?? {},
    },
    null,
    2,
  );

  const attachments = options.task.attachments ?? [];
  if (attachments.length === 0) return text;

  return [
    { type: "text" as const, text },
    ...(await Promise.all(attachments.map(attachmentToImagePart))),
  ];
}

function serializeToolResult(ok: boolean, result: unknown): string {
  try {
    return JSON.stringify({ ok, result });
  } catch {
    return JSON.stringify({
      ok: false,
      result: { error: "Tool result was not JSON serializable" },
    });
  }
}

export async function executeCherryAgentTask(
  options: ExecuteAgentTaskOptions,
): Promise<AgentExecutionResult> {
  const tools = options.tools ?? [];
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const approvals = new Set(options.approvals ?? []);
  const maxSteps = options.maxSteps ?? options.agent.maxSteps;
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: buildCherrySystemPrompt(options.agent),
    },
    {
      role: "user",
      content: await buildUserContent(options),
    },
  ];

  const emit = async (event: AgentLoopEvent) => {
    await options.onEvent?.(event);
  };

  await emit({
    type: "start",
    agentId: options.agent.id,
    step: 0,
    detail: { taskId: options.task.id },
  });

  const descriptors = tools.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }),
  );

  for (let step = 1; step <= maxSteps; step += 1) {
    const turn = await options.model.complete({
      agent: options.agent,
      messages: structuredClone(messages),
      tools: descriptors,
    });

    await emit({
      type: "model",
      agentId: options.agent.id,
      step,
      detail: {
        toolCalls: turn.toolCalls?.map((call) => call.name) ?? [],
      },
    });

    const calls = turn.toolCalls ?? [];
    if (calls.length > 0) {
      messages.push({
        role: "assistant",
        content: turn.content ?? "",
        toolCalls: calls,
      });
    } else if (turn.content) {
      messages.push({
        role: "assistant",
        content: turn.content,
      });
    }

    if (calls.length === 0) {
      const output = turn.content?.trim();
      if (!output) {
        throw new Error("Agent model returned neither content nor tool calls");
      }

      await emit({
        type: "complete",
        agentId: options.agent.id,
        step,
        detail: { output },
      });

      return {
        agentId: options.agent.id,
        taskId: options.task.id,
        output,
        steps: step,
        messages,
      };
    }

    for (const call of calls) {
      const tool = toolMap.get(call.name);

      await emit({
        type: "tool-call",
        agentId: options.agent.id,
        step,
        detail: { name: call.name, id: call.id },
      });

      let result: unknown;
      let ok = true;

      try {
        if (!tool) throw new Error(`Unknown tool: ${call.name}`);

        if (
          tool.allowedAgents &&
          !tool.allowedAgents.includes(options.agent.id)
        ) {
          throw new Error(
            `${options.agent.id} is not allowed to use ${tool.name}`,
          );
        }

        const approvalKey =
          tool.approvalKey ?? `${options.agent.id}:${tool.name}`;

        if (
          (tool.risk === "high" || tool.risk === "critical") &&
          !approvals.has(approvalKey)
        ) {
          throw new Error(`Approval required: ${approvalKey}`);
        }

        tool.validate?.(call.arguments);
        result = await tool.execute(call.arguments, {
          agent: options.agent,
          task: options.task,
          step,
        });
      } catch (error) {
        ok = false;
        result = {
          error:
            error instanceof Error ? error.message : "Tool execution failed",
        };
      }

      messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: serializeToolResult(ok, result),
      });

      await emit({
        type: "tool-result",
        agentId: options.agent.id,
        step,
        detail: { name: call.name, ok },
      });
    }
  }

  await emit({
    type: "limit",
    agentId: options.agent.id,
    step: maxSteps,
  });
  throw new AgentLoopLimitError(maxSteps);
}

export async function executeCherryTeamTask(
  options: Omit<ExecuteAgentTaskOptions, "agent" | "task"> & {
    task: ExecuteAgentTaskOptions["task"];
  },
): Promise<TeamExecutionResult> {
  const plan = createCherryTeamPlan(options.task);
  const results: TeamExecutionStepResult[] = [];
  const priorOutputs: Array<{
    phase: string;
    agentId: string;
    output: string;
  }> = [];

  for (const step of plan.steps) {
    const result = await executeCherryAgentTask({
      ...options,
      agent: step.agent,
      task: {
        ...options.task,
        objective: [
          step.instruction,
          `Original objective: ${options.task.objective}`,
          priorOutputs.length > 0
            ? `Prior team evidence: ${JSON.stringify(priorOutputs)}`
            : "No prior team evidence.",
        ].join("\n"),
        metadata: {
          ...options.task.metadata,
          teamPhase: step.phase,
          priorOutputs,
        },
      },
    });

    results.push({
      phase: step.phase,
      agentId: step.agent.id,
      result,
    });
    priorOutputs.push({
      phase: step.phase,
      agentId: step.agent.id,
      output: result.output,
    });
  }

  const final = results.at(-1);
  if (!final) throw new Error("Cherry Team plan did not contain any steps");

  return {
    taskId: options.task.id,
    plan,
    steps: results,
    output: final.result.output,
  };
}
