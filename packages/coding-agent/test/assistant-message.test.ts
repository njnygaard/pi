import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

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

function createAssistantMessage(
	content: AssistantMessage["content"],
	overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
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
		stopReason: overrides.stopReason ?? "stop",
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

	test("renders length stops as visible errors", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }], { stopReason: "length" }),
			true,
		);
		const rendered = component.render(80).join("\n");

		expect(rendered).toContain("Thinking...");
		expect(rendered).toContain("maximum output token limit");
		expect(rendered).toContain("response may be incomplete");
	});

	test("uses configured output padding for text and thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "reasoning" },
			]),
			false,
			undefined,
			"Thinking...",
			1,
		);
		const lines = component.render(80).map(stripControlSequences);

		expect(lines.some((line) => line.includes(" hello"))).toBe(true);
		expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

		component.setOutputPad(0);
		const updatedLines = component.render(80).map(stripControlSequences);
		expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
		expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
	});

	test("uses configured output padding for user messages", () => {
		initTheme("dark");

		const paddedComponent = new UserMessageComponent("hello", undefined, 1);
		const paddedLines = paddedComponent.render(40).map(stripControlSequences);
		expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

		const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
		const unpaddedLines = unpaddedComponent.render(40).map(stripControlSequences);
		expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
	});

	test("can restate the user prompt and render an agent response bar", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "Start here" }]),
			false,
			undefined,
			"Thinking...",
			0,
			"What should I do next?",
		);
		const lines = component.render(40).map(stripControlSequences);
		const promptLine = lines.find((line) => line.includes("What should I do next?"));
		const barLine = lines.find((line) => line.includes("Agent Response"));

		expect(promptLine).toBeDefined();
		expect(promptLine?.startsWith("What should I do next?")).toBe(true);
		expect(barLine).toBeDefined();
		expect(barLine).toHaveLength(40);
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
