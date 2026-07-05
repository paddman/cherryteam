import type {
  AgentRouteDecision,
  AgentTask,
  CherryAgentDefinition,
  CherryAgentId,
  CherryAgentLayer,
  CherryTeamPlan,
} from "./types.js";

export const CHERRY_AGENT_TEAM: readonly CherryAgentDefinition[] = [
  {
    id: "cherry-admin",
    name: "Cherry Admin",
    layer: "admin",
    mission:
      "Provide the operating foundation: access, schedules, records, policy, audit, and tool governance.",
    capabilities: [
      "access-control",
      "scheduling",
      "records",
      "finance-ops",
      "audit",
      "tool-governance",
      "workspace-management",
    ],
    delegatesTo: [
      "cherry-delivery",
      "cherry-marketing",
      "cherry-sales",
      "cherry-leadership",
    ],
    requiresApprovalFor: [
      "delete",
      "credential-change",
      "financial-commitment",
    ],
    maxSteps: 6,
  },
  {
    id: "cherry-delivery",
    name: "Cherry Delivery",
    layer: "delivery",
    mission:
      "Execute and verify workflows, infrastructure operations, incidents, customer work, and final deliverables.",
    capabilities: [
      "workflow-execution",
      "customer-fulfillment",
      "incident-response",
      "quality-assurance",
      "file-processing",
      "vision-analysis",
      "infrastructure-ops",
    ],
    delegatesTo: ["cherry-admin", "cherry-leadership"],
    requiresApprovalFor: [
      "production-change",
      "destructive-operation",
      "external-delivery",
    ],
    maxSteps: 12,
  },
  {
    id: "cherry-marketing",
    name: "Cherry Marketing",
    layer: "marketing",
    mission:
      "Create demand through research, positioning, campaigns, content, brand assets, and performance analysis.",
    capabilities: [
      "audience-research",
      "campaign-planning",
      "content-creation",
      "brand-management",
      "vision-analysis",
      "marketing-analytics",
    ],
    delegatesTo: [
      "cherry-delivery",
      "cherry-sales",
      "cherry-leadership",
    ],
    requiresApprovalFor: ["publish-campaign", "brand-change", "ad-spend"],
    maxSteps: 10,
  },
  {
    id: "cherry-sales",
    name: "Cherry Sales",
    layer: "sales",
    mission:
      "Convert qualified demand into revenue through lead handling, CRM work, proposals, pricing, and follow-up.",
    capabilities: [
      "lead-qualification",
      "crm-management",
      "proposal-writing",
      "pricing",
      "follow-up",
      "pipeline-analysis",
    ],
    delegatesTo: [
      "cherry-admin",
      "cherry-delivery",
      "cherry-marketing",
      "cherry-leadership",
    ],
    requiresApprovalFor: [
      "discount",
      "contract-commitment",
      "pricing-exception",
    ],
    maxSteps: 10,
  },
  {
    id: "cherry-leadership",
    name: "Cherry Leadership",
    layer: "leadership",
    mission:
      "Set direction, prioritize work, approve high-risk actions, review KPIs, and delegate to the right operating agent.",
    capabilities: [
      "strategy",
      "prioritization",
      "approval",
      "kpi-review",
      "delegation",
      "risk-management",
      "budget-governance",
    ],
    delegatesTo: [
      "cherry-admin",
      "cherry-delivery",
      "cherry-marketing",
      "cherry-sales",
    ],
    requiresApprovalFor: ["irreversible-decision"],
    maxSteps: 8,
  },
] as const;

const KEYWORDS: Record<CherryAgentLayer, readonly string[]> = {
  admin: [
    "admin",
    "permission",
    "access",
    "account",
    "schedule",
    "calendar",
    "record",
    "invoice",
    "audit",
    "policy",
    "credential",
  ],
  delivery: [
    "deliver",
    "execute",
    "deploy",
    "incident",
    "server",
    "infra",
    "workflow",
    "fix",
    "build",
    "test",
    "customer work",
    "production",
  ],
  marketing: [
    "marketing",
    "campaign",
    "content",
    "brand",
    "audience",
    "seo",
    "social",
    "advert",
    "creative",
    "market research",
  ],
  sales: [
    "sales",
    "lead",
    "crm",
    "proposal",
    "quotation",
    "quote",
    "customer follow-up",
    "pipeline",
    "deal",
    "contract",
    "pricing",
  ],
  leadership: [
    "strategy",
    "leadership",
    "approve",
    "approval",
    "priority",
    "budget",
    "kpi",
    "direction",
    "portfolio",
    "risk decision",
  ],
};

export function getCherryAgent(
  id: CherryAgentId,
  team: readonly CherryAgentDefinition[] = CHERRY_AGENT_TEAM,
): CherryAgentDefinition {
  const agent = team.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`Unknown Cherry agent: ${id}`);
  return agent;
}

export function routeCherryTask(
  task: AgentTask,
  team: readonly CherryAgentDefinition[] = CHERRY_AGENT_TEAM,
): AgentRouteDecision {
  if (!task.objective.trim()) throw new Error("Task objective is required");

  const text = `${task.objective} ${(task.tags ?? []).join(" ")}`.toLowerCase();
  const requested = new Set(
    (task.requiredCapabilities ?? []).map((value) => value.toLowerCase()),
  );
  const risk = task.risk ?? "medium";

  const decisions = team.map((agent) => {
    let score = 0;
    const reasons: string[] = [];

    const capabilityMatches = agent.capabilities.filter((capability) =>
      requested.has(capability.toLowerCase()),
    );
    if (capabilityMatches.length > 0) {
      score += capabilityMatches.length * 12;
      reasons.push(`capabilities: ${capabilityMatches.join(", ")}`);
    }

    const keywordMatches = KEYWORDS[agent.layer].filter((keyword) =>
      text.includes(keyword),
    );
    if (keywordMatches.length > 0) {
      score += keywordMatches.length * 4;
      reasons.push(`keywords: ${keywordMatches.join(", ")}`);
    }

    if (
      (task.attachments?.length ?? 0) > 0 &&
      agent.capabilities.includes("vision-analysis")
    ) {
      score += 6;
      reasons.push("vision attachment");
    }

    if (
      (risk === "high" || risk === "critical") &&
      agent.layer === "leadership"
    ) {
      score += risk === "critical" ? 24 : 14;
      reasons.push(`${risk}-risk governance`);
    }

    if (
      risk === "low" &&
      agent.layer === "leadership" &&
      keywordMatches.length === 0
    ) {
      score -= 5;
    }

    if (agent.layer === "delivery" && score === 0) score += 1;
    return { agent, score, reasons };
  });

  decisions.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.agent.id.localeCompare(right.agent.id);
  });

  const selected = decisions[0];
  if (!selected) throw new Error("Cherry Agent Team is empty");
  return selected;
}

export function createCherryTeamPlan(
  task: AgentTask,
  team: readonly CherryAgentDefinition[] = CHERRY_AGENT_TEAM,
): CherryTeamPlan {
  const route = routeCherryTask(task, team);
  const risk = task.risk ?? "medium";
  const steps: CherryTeamPlan["steps"] = [];

  const needsAdmin =
    task.requiresAdminPreflight === true ||
    risk === "high" ||
    risk === "critical" ||
    (task.tags ?? []).some((tag) =>
      ["access", "credential", "production"].includes(tag.toLowerCase()),
    );

  if (needsAdmin && route.agent.id !== "cherry-admin") {
    steps.push({
      phase: "preflight",
      agent: getCherryAgent("cherry-admin", team),
      instruction:
        "Validate access, tool policy, audit requirements, and rollback readiness before execution.",
    });
  }

  steps.push({
    phase: "execute",
    agent: route.agent,
    instruction: `Own the task outcome: ${task.objective}`,
  });

  const needsLeadershipApproval =
    (risk === "high" || risk === "critical") &&
    route.agent.id !== "cherry-leadership";

  if (needsLeadershipApproval) {
    steps.push({
      phase: "approve",
      agent: getCherryAgent("cherry-leadership", team),
      instruction:
        "Review evidence, risk, business impact, and approve or reject the proposed action.",
    });
  }

  return {
    taskId: task.id,
    primaryAgent: route.agent,
    route,
    steps,
  };
}
