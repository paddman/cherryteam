#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { executeCherryTeamTask } from "./loop.js";
import { OpenAICompatibleProvider } from "./provider-openai.js";
import { createBuiltinTools } from "./tools.js";
import type { AgentLoopEvent, AgentTask, VisionAttachment } from "./types.js";

interface CliOptions {
  objective: string;
  images: string[];
  workspace: string;
  risk: AgentTask["risk"];
  approvals: string[];
  verbose: boolean;
}

function usage(): string {
  return `
CherryTeam — ops-first multi-agent tool-call and vision runtime

Usage:
  npm run dev -- "task objective" [options]

Options:
  --image <path-or-url>       Attach an image. Repeat for multiple images.
  --workspace <path>          Sandboxed tool workspace.
  --risk <level>              low | medium | high | critical
  --approve <key>             Add a high-risk tool approval key.
  --verbose                   Print agent-loop events.
  --help                      Show this help.

Environment:
  CHERRY_API_BASE             OpenAI-compatible /v1 base URL
  CHERRY_API_KEY              Bearer token
  CHERRY_MODEL                Model identifier
  CHERRY_MAX_STEPS            Maximum steps per agent
  CHERRY_WORKSPACE            Default workspace
  CHERRY_ALLOWED_COMMANDS     Comma-separated command allowlist
`.trim();
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.length === 0) {
    console.log(usage());
    process.exit(0);
  }

  let objective = "";
  const images: string[] = [];
  const approvals: string[] = [];
  let workspace = process.env.CHERRY_WORKSPACE ?? "./workspace";
  let risk: AgentTask["risk"] = "medium";
  let verbose = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--image") {
      images.push(takeValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--workspace") {
      workspace = takeValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--risk") {
      const value = takeValue(argv, index, arg);
      if (!["low", "medium", "high", "critical"].includes(value)) {
        throw new Error(`Invalid risk level: ${value}`);
      }
      risk = value as AgentTask["risk"];
      index += 1;
      continue;
    }

    if (arg === "--approve") {
      approvals.push(takeValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--verbose") {
      verbose = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    objective = objective ? `${objective} ${arg}` : arg;
  }

  if (!objective.trim()) throw new Error("Task objective is required");
  return { objective, images, workspace, risk, approvals, verbose };
}

function toAttachment(value: string): VisionAttachment {
  if (/^https?:\/\//i.test(value)) {
    return { type: "image", url: value };
  }
  return { type: "image", path: resolve(value) };
}

function eventLogger(event: AgentLoopEvent): void {
  const detail = event.detail ? ` ${JSON.stringify(event.detail)}` : "";
  console.error(
    `[${event.agentId}] step=${event.step} ${event.type}${detail}`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workspace = resolve(options.workspace);
  await mkdir(workspace, { recursive: true });

  const baseUrl = process.env.CHERRY_API_BASE ?? "http://localhost:8000/v1";
  const modelName = process.env.CHERRY_MODEL ?? "qwen3.5-35b-a3b";
  const maxSteps = Number(process.env.CHERRY_MAX_STEPS ?? "12");
  const allowedCommands = (
    process.env.CHERRY_ALLOWED_COMMANDS ??
    "pwd,ls,cat,grep,find,head,tail,wc,node,npm,pnpm,git"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const model = new OpenAICompatibleProvider({
    baseUrl,
    apiKey: process.env.CHERRY_API_KEY,
    model: modelName,
  });

  const tools = createBuiltinTools({
    workspace,
    allowedCommands,
    httpTimeoutMs: Number(process.env.CHERRY_HTTP_TIMEOUT_MS ?? "15000"),
  });

  const task: AgentTask = {
    id: `task-${Date.now()}`,
    objective: options.objective,
    risk: options.risk,
    attachments: options.images.map(toAttachment),
  };

  const result = await executeCherryTeamTask({
    task,
    model,
    tools,
    approvals: options.approvals,
    maxSteps,
    onEvent: options.verbose ? eventLogger : undefined,
  });

  console.log(result.output);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
