import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getModelName, getOpenAIClient } from "./openaiClient";

type RunPromptOptions<TOutput> = {
  promptFile: string;
  input: unknown;
  outputSchema: z.ZodType<TOutput>;
};

function getPromptsDir(): string {
  return path.resolve(process.cwd(), "prompts");
}

async function loadPrompt(fileName: string): Promise<string> {
  const promptPath = path.join(getPromptsDir(), fileName);
  return readFile(promptPath, "utf8");
}

function parseModelJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (fencedJson) {
      return JSON.parse(fencedJson.trim());
    }

    const fencedAny = raw.match(/```([\s\S]*?)```/i)?.[1];
    if (fencedAny) {
      return JSON.parse(fencedAny.trim());
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error("Model response is not valid JSON");
  }
}

export async function runPrompt<TOutput>({
  promptFile,
  input,
  outputSchema,
}: RunPromptOptions<TOutput>): Promise<TOutput> {
  const [systemPrompt, taskPrompt] = await Promise.all([
    loadPrompt("system.md"),
    loadPrompt(promptFile),
  ]);

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: getModelName(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt.trim(),
      },
      {
        role: "user",
        content: `${taskPrompt.trim()}\n\nInput JSON:\n${JSON.stringify(input, null, 2)}\n\nReturn only valid JSON.`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Model returned an empty response");
  }

  const parsed = parseModelJson(raw);
  return outputSchema.parse(parsed);
}
