export type CherryAgentLayer =
  | "admin"
  | "delivery"
  | "marketing"
  | "sales"
  | "leadership";

export type CherryAgentId = `cherry-${CherryAgentLayer}`;
export type TaskRisk = "low" | "medium" | "high" | "critical";

export interface VisionAttachment {
  type: "image";
  mimeType?: string;
  url?: string;
  path?: string;
  description?: string;
}

export interface AgentTask {
  id: string;
  objective: string;
  requiredCapabilities?: string[];
  risk?: TaskRisk;
  attachments?: VisionAttachment[];
  requiresAdminPreflight?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CherryAgentDefinition {
  id: CherryAgentId;
  name: string;
  layer: CherryAgentLayer;
  mission: string;
  capabilities: readonly string[];
  delegatesTo: readonly CherryAgentId[];
  requiresApprovalFor: readonly string[];
  maxSteps: number;
}

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type MessageContent = string | Array<TextContentPart | ImageContentPart>;

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent;
  name?: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentModelTurn {
  content?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface AgentModel {
  complete(input: {
    agent: CherryAgentDefinition;
    messages: AgentMessage[];
    tools: AgentToolDescriptor[];
  }): Promise<AgentModelTurn>;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  allowedAgents?: CherryAgentId[];
  risk?: TaskRisk;
  approvalKey?: string;
  validate?: (arguments_: Record<string, unknown>) => void;
  execute: (
    arguments_: Record<string, unknown>,
    context: {
      agent: CherryAgentDefinition;
      task: AgentTask;
      step: number;
    },
  ) => Promise<unknown> | unknown;
}

export interface AgentLoopEvent {
  type:
    | "start"
    | "model"
    | "tool-call"
    | "tool-result"
    | "complete"
    | "limit";
  agentId: CherryAgentId;
  step: number;
  detail?: Record<string, unknown>;
}

export interface AgentExecutionResult {
  agentId: CherryAgentId;
  taskId: string;
  output: string;
  steps: number;
  messages: AgentMessage[];
}

export interface ExecuteAgentTaskOptions {
  agent: CherryAgentDefinition;
  task: AgentTask;
  model: AgentModel;
  tools?: AgentTool[];
  approvals?: string[];
  maxSteps?: number;
  onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
}

export type TeamPlanPhase = "preflight" | "execute" | "approve";

export interface TeamPlanStep {
  phase: TeamPlanPhase;
  agent: CherryAgentDefinition;
  instruction: string;
}

export interface AgentRouteDecision {
  agent: CherryAgentDefinition;
  score: number;
  reasons: string[];
}

export interface CherryTeamPlan {
  taskId: string;
  primaryAgent: CherryAgentDefinition;
  route: AgentRouteDecision;
  steps: TeamPlanStep[];
}

export interface TeamExecutionStepResult {
  phase: TeamPlanPhase;
  agentId: CherryAgentId;
  result: AgentExecutionResult;
}

export interface TeamExecutionResult {
  taskId: string;
  plan: CherryTeamPlan;
  steps: TeamExecutionStepResult[];
  output: string;
}
