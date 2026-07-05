# CherryTeam

**Ops-first multi-agent runtime with tool calling, vision input, deterministic routing, approvals, and bounded execution loops.**

![Cherry Agent Team ladder](docs/cherry-team-ladder.svg)

CherryTeam models five business agents:

| Agent | Main job |
|---|---|
| **Cherry Admin** | Access, schedules, records, policy, audit, tool governance |
| **Cherry Delivery** | Workflow execution, infrastructure, incidents, QA, customer output |
| **Cherry Marketing** | Research, positioning, campaigns, content, brand, analytics |
| **Cherry Sales** | Leads, CRM, proposals, pricing, follow-up, pipeline |
| **Cherry Leadership** | Strategy, priorities, KPI review, budget, high-risk approval |

The ladder is a support model, not a slow chain of command. Normal work is routed directly to the best agent. Admin preflight and Leadership approval appear only where risk and governance require them.

## What works now

- OpenAI-compatible model adapter for Qwen, vLLM, SGLang, LM Studio, or compatible servers.
- Multiple image attachments using local paths, data URLs, or public URLs.
- Model → tool call → real tool result → model continuation loop.
- Five-agent deterministic router.
- High-risk team plans with Admin preflight and Leadership approval.
- Per-agent tool allowlists.
- Approval keys for high-risk and critical tools.
- Maximum loop steps.
- Workspace sandbox for file tools.
- Command allowlist without `shell=true`.
- Bounded HTTP GET tool.
- Unit tests and GitHub Actions CI.

## Quick start

Requirements:

- Node.js 20+
- npm
- OpenAI-compatible model endpoint

```bash
git clone https://github.com/paddman/cherryteam.git
cd cherryteam

npm install
cp .env.example .env
```

Set the environment:

```bash
export CHERRY_API_BASE=http://localhost:8000/v1
export CHERRY_API_KEY=local
export CHERRY_MODEL=qwen3.5-35b-a3b
```

Run a daily operations task:

```bash
npm run dev -- \
  "ตรวจสอบไฟล์ใน workspace แล้วสร้าง reports/status.md" \
  --workspace ./workspace \
  --verbose
```

Run with vision:

```bash
npm run dev -- \
  "วิเคราะห์ screenshot นี้ สรุปสาเหตุ และเขียน diagnosis.md" \
  --image ./incident.png \
  --workspace ./workspace \
  --verbose
```

Attach multiple images:

```bash
npm run dev -- \
  "เปรียบเทียบ dashboard ก่อนและหลังแก้ไข" \
  --image ./before.png \
  --image ./after.png
```

## High-risk tools and approvals

`run_command` is marked high risk. The default approval key is:

```text
<agent-id>:<tool-name>
```

For Cherry Delivery:

```bash
npm run dev -- \
  "ใช้คำสั่ง git status เพื่อตรวจ workspace" \
  --risk high \
  --approve cherry-delivery:run_command \
  --verbose
```

For production work, define explicit ticket-based approval keys in custom tools:

```ts
{
  name: "restart_production",
  risk: "high",
  approvalKey: "change:INC-001",
  allowedAgents: ["cherry-delivery"],
  execute: async ({ service }) => operations.restart(String(service))
}
```

Then provide:

```text
--approve change:INC-001
```

## Agent loop

```text
Observe task and available images
              ↓
Choose a tool or finish
              ↓
Validate agent permission and approval
              ↓
Execute one constrained tool call
              ↓
Read the actual result
              ↓
Continue, request approval, delegate, or finish
```

The system prompt explicitly forbids claiming success without a successful tool result and asks for concise evidence instead of private chain-of-thought.

## Built-in tools

| Tool | Agents | Risk |
|---|---|---|
| `read_file` | All agents | Low |
| `write_file` | Admin, Delivery, Marketing, Sales | Medium |
| `list_files` | All agents | Low |
| `run_command` | Admin, Delivery | High |
| `http_get` | Delivery, Marketing, Sales, Leadership | Low |

All file paths are constrained to `CHERRY_WORKSPACE`.

`run_command` executes an allowlisted executable with an argument array and does not use a shell. Pipelines, redirects, command substitution, and shell operators are not accepted.

## Programmatic use

```ts
import {
  createBuiltinTools,
  executeCherryTeamTask,
  OpenAICompatibleProvider,
} from "cherryteam";

const model = new OpenAICompatibleProvider({
  baseUrl: "http://localhost:8000/v1",
  apiKey: "local",
  model: "qwen3.5-35b-a3b",
});

const result = await executeCherryTeamTask({
  task: {
    id: "incident-001",
    objective: "Analyze the screenshot and prepare an incident report",
    risk: "medium",
    attachments: [
      {
        type: "image",
        path: "./incident.png",
      },
    ],
  },
  model,
  tools: createBuiltinTools({
    workspace: "./workspace",
  }),
});

console.log(result.plan.primaryAgent.id);
console.log(result.output);
```

## Team routing examples

```ts
import { createCherryTeamPlan } from "cherryteam";

const plan = createCherryTeamPlan({
  id: "deploy-001",
  objective: "Deploy and verify a production server incident fix",
  risk: "high",
  tags: ["production"],
});

console.log(
  plan.steps.map((step) => `${step.phase}: ${step.agent.id}`),
);
```

Expected plan:

```text
preflight: cherry-admin
execute: cherry-delivery
approve: cherry-leadership
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CHERRY_API_BASE` | `http://localhost:8000/v1` | Model API base |
| `CHERRY_API_KEY` | empty | Bearer token |
| `CHERRY_MODEL` | `qwen3.5-35b-a3b` | Model identifier |
| `CHERRY_MAX_STEPS` | `12` | Maximum steps per agent |
| `CHERRY_WORKSPACE` | `./workspace` | File and command sandbox |
| `CHERRY_ALLOWED_COMMANDS` | safe utility list | Executable allowlist |
| `CHERRY_HTTP_TIMEOUT_MS` | `15000` | HTTP tool timeout |

## Validation

```bash
npm test
npm run build
npm run check
```

See [architecture](docs/architecture.md) for the production layout and operating metrics.
