import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SKILL_NAME = "direct-visual-identity";
const SKILL_ROOT_URI = `skill://visual-identity-os/${SKILL_NAME}`;
const SKILL_FILES = [
  "SKILL.md",
  "references/authority-and-gates.md",
  "references/prompt-and-review.md",
] as const;

type SkillResource = {
  uri: string;
  digest: string;
  text: string;
  mimeType: string;
};

export type PluginSkillEntry = {
  uri: string;
  frontmatter: {
    name: string;
    description: string;
  };
  resources: Array<{ uri: string; digest: string }>;
};

function skillDirectory(): string {
  return path.resolve(process.cwd(), "skills", SKILL_NAME);
}

function resourceFor(relativePath: (typeof SKILL_FILES)[number]): SkillResource {
  const text = readFileSync(path.join(skillDirectory(), relativePath), "utf8");
  return {
    uri: `${SKILL_ROOT_URI}/${relativePath}`,
    digest: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
    text,
    mimeType: relativePath.endsWith(".md") ? "text/markdown" : "text/plain",
  };
}

export function loadDirectVisualIdentitySkill(): {
  entry: PluginSkillEntry;
  resources: SkillResource[];
} {
  const resources = SKILL_FILES.map(resourceFor);
  return {
    entry: {
      uri: `${SKILL_ROOT_URI}/SKILL.md`,
      frontmatter: {
        name: SKILL_NAME,
        description:
          "Dirigir generación, edición y revisión visual con el canon Visual Identity OS V6, incluyendo la ejecución completa de solicitudes persistidas mediante el generador nativo del host.",
      },
      resources: resources.map(({ uri, digest }) => ({ uri, digest })),
    },
    resources,
  };
}

const SkillsListRequestSchema = z.object({
  method: z.literal("skills/list"),
  params: z.object({ cursor: z.string().optional() }).optional(),
});

const SkillsGetRequestSchema = z.object({
  method: z.literal("skills/get"),
  params: z.object({ uri: z.string() }),
});

export function registerPluginSkills(server: McpServer): void {
  const skill = loadDirectVisualIdentitySkill();

  for (const resource of skill.resources) {
    server.registerResource(
      resource.uri.split("/").at(-1) || resource.uri,
      resource.uri,
      { mimeType: resource.mimeType },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      })
    );
  }

  // SEP-2640 is an OpenAI-supported bounded MCP extension. The upstream SDK
  // does not yet export its request/result types, so these two handlers use
  // the generic protocol surface while keeping strict local schemas.
  const protocol = server.server as unknown as {
    setRequestHandler: (
      schema: z.ZodType,
      handler: (request: z.infer<typeof SkillsGetRequestSchema>) => Promise<unknown>
    ) => void;
  };
  protocol.setRequestHandler(
    SkillsListRequestSchema,
    async () => ({ skills: [skill.entry] })
  );
  protocol.setRequestHandler(
    SkillsGetRequestSchema,
    async (request) => {
      if (request.params.uri !== skill.entry.uri) {
        throw new Error("Unknown skill URI");
      }
      return { skill: skill.entry };
    }
  );
}
