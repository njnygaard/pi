import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	Box,
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

class AgentResponseBar implements Component {
	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const label = " Agent Response ";
		const base =
			visibleWidth(label) >= safeWidth
				? truncateToWidth(label, safeWidth, "")
				: label + " ".repeat(safeWidth - visibleWidth(label));

		// Invert the active accent foreground so the bar uses the same highlight color
		// as the selected theme without requiring a separate background token.
		return [`\x1b[7m${theme.getFgAnsi("accent")}${base}\x1b[27m\x1b[39m`];
	}
}

class PromptRestatement extends Container {
	constructor(promptText: string, markdownTheme: MarkdownTheme) {
		super();
		const box = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
		box.addChild(
			new Markdown(promptText.trim(), 0, 0, markdownTheme, {
				color: (content: string) => theme.fg("userMessageText", content),
			}),
		);
		this.addChild(box);
	}
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private assistantPaddingX: number;
	private promptText?: string;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		assistantPaddingX = 1,
		promptText?: string,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.assistantPaddingX = Math.max(0, Math.floor(assistantPaddingX));
		this.promptText = promptText;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setAssistantPaddingX(padding: number): void {
		this.assistantPaddingX = Math.max(0, Math.floor(padding));
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setPromptText(promptText?: string): void {
		this.promptText = promptText;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	rendersOnlyHiddenThinkingLabelBeforeToolCalls(): boolean {
		if (!this.hideThinkingBlock || !this.lastMessage) {
			return false;
		}

		let nonEmptyThinkingBlocks = 0;
		let hasToolCall = false;
		for (const content of this.lastMessage.content) {
			if (content.type === "text" && content.text.trim()) {
				return false;
			}
			if (content.type === "thinking" && content.thinking.trim()) {
				nonEmptyThinkingBlocks += 1;
			}
			if (content.type === "toolCall") {
				hasToolCall = true;
			}
		}

		return hasToolCall && nonEmptyThinkingBlocks === 1;
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		let renderedResponseHeader = false;

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				if (!renderedResponseHeader) {
					if (this.promptText?.trim()) {
						this.contentContainer.addChild(new PromptRestatement(this.promptText, this.markdownTheme));
					}
					this.contentContainer.addChild(new AgentResponseBar());
					this.contentContainer.addChild(new Spacer(1));
					renderedResponseHeader = true;
				}

				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), this.assistantPaddingX, 0, this.markdownTheme),
				);
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static thinking label when hidden
					this.contentContainer.addChild(
						new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.assistantPaddingX, 0),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), this.assistantPaddingX, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleContent) {
					this.contentContainer.addChild(new Spacer(1));
				} else {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.assistantPaddingX, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(
					new Text(theme.fg("error", `Error: ${errorMsg}`), this.assistantPaddingX, 0),
				);
			}
		}
	}
}
