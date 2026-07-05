import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { AgentTool } from "./types.js";

export interface BuiltinToolOptions {
  workspace: string;
  allowedCommands?: string[];
  httpTimeoutMs?: number;
  maxHttpBytes?: number;
}

function asString(
  value: unknown,
  field: string,
  options: { optional?: boolean } = {},
): string {
  if (typeof value === "string" && value.trim()) return value;
  if (options.optional && (value === undefined || value === null)) return "";
  throw new Error(`${field} must be a non-empty string`);
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value as string[];
}

function resolveInsideWorkspace(workspace: string, requestedPath: string): string {
  const base = resolve(workspace);
  const target = resolve(base, requestedPath);
  const relation = relative(base, target);

  if (
    relation === ".." ||
    relation.startsWith("../") ||
    relation.startsWith("..\\")
  ) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  return target;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Command timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

export function createBuiltinTools(options: BuiltinToolOptions): AgentTool[] {
  const workspace = resolve(options.workspace);
  const allowedCommands = new Set(
    options.allowedCommands ?? [
      "pwd",
      "ls",
      "cat",
      "grep",
      "find",
      "head",
      "tail",
      "wc",
      "node",
      "npm",
      "pnpm",
      "git",
    ],
  );
  const httpTimeoutMs = options.httpTimeoutMs ?? 15_000;
  const maxHttpBytes = options.maxHttpBytes ?? 1_000_000;

  return [
    {
      name: "read_file",
      description:
        "Read a UTF-8 text file inside the configured workspace.",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
        },
        additionalProperties: false,
      },
      allowedAgents: [
        "cherry-admin",
        "cherry-delivery",
        "cherry-marketing",
        "cherry-sales",
        "cherry-leadership",
      ],
      async execute(arguments_) {
        const path = resolveInsideWorkspace(
          workspace,
          asString(arguments_.path, "path"),
        );
        return {
          path: relative(workspace, path),
          content: await readFile(path, "utf8"),
        };
      },
    },
    {
      name: "write_file",
      description:
        "Write a UTF-8 text file inside the workspace. Parent directories are created automatically.",
      inputSchema: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        additionalProperties: false,
      },
      allowedAgents: [
        "cherry-admin",
        "cherry-delivery",
        "cherry-marketing",
        "cherry-sales",
      ],
      risk: "medium",
      async execute(arguments_) {
        const path = resolveInsideWorkspace(
          workspace,
          asString(arguments_.path, "path"),
        );
        const content = asString(arguments_.content, "content", {
          optional: true,
        });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        return {
          path: relative(workspace, path),
          bytes: Buffer.byteLength(content),
        };
      },
    },
    {
      name: "list_files",
      description:
        "List files and directories at a path inside the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        additionalProperties: false,
      },
      allowedAgents: [
        "cherry-admin",
        "cherry-delivery",
        "cherry-marketing",
        "cherry-sales",
        "cherry-leadership",
      ],
      async execute(arguments_) {
        const requested =
          typeof arguments_.path === "string" ? arguments_.path : ".";
        const path = resolveInsideWorkspace(workspace, requested);
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        }));
      },
    },
    {
      name: "run_command",
      description:
        "Run one allowlisted executable with an argument array inside the workspace. Shell syntax and pipelines are not supported.",
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          args: {
            type: "array",
            items: { type: "string" },
          },
          timeoutMs: { type: "number" },
        },
        additionalProperties: false,
      },
      allowedAgents: ["cherry-admin", "cherry-delivery"],
      risk: "high",
      validate(arguments_) {
        const command = asString(arguments_.command, "command");
        if (!allowedCommands.has(command)) {
          throw new Error(`Command is not allowlisted: ${command}`);
        }
        if (
          arguments_.args !== undefined &&
          (!Array.isArray(arguments_.args) ||
            arguments_.args.some((item) => typeof item !== "string"))
        ) {
          throw new Error("args must be an array of strings");
        }
      },
      async execute(arguments_) {
        const command = asString(arguments_.command, "command");
        const args =
          arguments_.args === undefined
            ? []
            : asStringArray(arguments_.args, "args");
        const timeoutMs =
          typeof arguments_.timeoutMs === "number"
            ? arguments_.timeoutMs
            : 30_000;
        return await runProcess(command, args, workspace, timeoutMs);
      },
    },
    {
      name: "http_get",
      description:
        "Fetch a public HTTP or HTTPS URL and return a bounded text response.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
        },
        additionalProperties: false,
      },
      allowedAgents: [
        "cherry-delivery",
        "cherry-marketing",
        "cherry-sales",
        "cherry-leadership",
      ],
      async execute(arguments_) {
        const url = new URL(asString(arguments_.url, "url"));
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error(`Unsupported URL protocol: ${url.protocol}`);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), httpTimeoutMs);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
          });
          const body = await response.text();
          const truncated =
            Buffer.byteLength(body) > maxHttpBytes
              ? body.slice(0, maxHttpBytes)
              : body;

          return {
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: truncated,
            truncated: truncated.length !== body.length,
          };
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}
