import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import stripAnsi from "strip-ansi";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function stripControlSequences(line: string): string {
	return stripAnsi(line).replace(/\x1b\]133;[ABC]\x07/g, "");
}

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("respects assistant message horizontal padding", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "hello" }]),
			false,
			undefined,
			"Thinking...",
			0,
		);
		const contentLine = component
			.render(40)
			.map(stripControlSequences)
			.find((line) => line.includes("hello"));

		expect(contentLine?.trimEnd()).toBe("hello");
	});

	test("renders code fences with a full-width opaque background", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "```bash\necho hi\n```" }]),
			false,
			undefined,
			"Thinking...",
			0,
		);
		const fenceLine = component.render(40).find((line) => line.includes("```bash"));

		expect(fenceLine).toContain(theme.getBgAnsi("selectedBg"));
		expect(stripControlSequences(fenceLine ?? "")).toHaveLength(40);
	});

	test("reports hidden-thinking-only assistant messages before tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "private reasoning", thinkingSignature: "sig" },
				{ type: "toolCall", id: "tool-1", name: "edit", arguments: { path: "file.txt", edits: [] } },
			]),
			true,
			undefined,
			"Thinking...",
			0,
		);

		expect(component.rendersOnlyHiddenThinkingLabelBeforeToolCalls()).toBe(true);
	});

	test("can render a hidden thinking label immediately followed by a tool call without a blank row", () => {
		initTheme("dark");

		const assistant = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "private reasoning", thinkingSignature: "sig" },
				{
					type: "toolCall",
					id: "tool-1",
					name: "edit",
					arguments: { path: "file.txt", edits: [{ oldText: "a", newText: "b" }] },
				},
			]),
			true,
			undefined,
			"Thinking...",
			0,
		);
		const tool = new ToolExecutionComponent(
			"edit",
			"tool-1",
			{ path: "file.txt", edits: [{ oldText: "a", newText: "b" }] },
			{ leadingSpacer: !assistant.rendersOnlyHiddenThinkingLabelBeforeToolCalls() },
			undefined,
			createFakeTui(),
			process.cwd(),
		);

		const lines = [...assistant.render(80), ...tool.render(80)].map(stripControlSequences);
		const thinkingLine = lines.findIndex((line) => line.trim() === "Thinking...");

		expect(thinkingLine).toBeGreaterThanOrEqual(0);
		expect(lines[thinkingLine + 1]?.trim()).toContain("edit");
	});
});
