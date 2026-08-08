import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type {
	ConnectionDecision,
	ReviewableConnection,
} from '../data/fragment-repository';

export interface ConnectionReviewSubmission extends ReviewableConnection {
	decision: ConnectionDecision;
}

const CONFIDENCE_LABELS = {
	low: '低',
	medium: '中',
	high: '高',
} as const;

export class AiConnectionReviewModal extends Modal {
	private currentIndex = 0;
	private relationInput!: TextComponent;
	private reasonInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly suggestions: ReviewableConnection[],
		private readonly onDecision: (
			submission: ConnectionReviewSubmission,
		) => Promise<void>,
		private readonly onComplete: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.renderCurrent();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderCurrent(): void {
		this.contentEl.empty();
		this.contentEl.addClass('haidencyril-ai-review-modal');
		const suggestion = this.suggestions[this.currentIndex];
		if (!suggestion) {
			this.close();
			return;
		}

		this.contentEl.createEl('h2', { text: '检查关联建议' });
		this.contentEl.createEl('p', {
			text: `第 ${this.currentIndex + 1} / ${this.suggestions.length} 条`,
			cls: 'haidencyril-muted',
		});
		const target = this.contentEl.createDiv({
			cls: 'haidencyril-ai-review-target',
		});
		target.createEl('strong', { text: suggestion.targetFile.basename });
		target.createSpan({
			text: `AI 置信度：${CONFIDENCE_LABELS[suggestion.confidence]}`,
		});

		new Setting(this.contentEl)
			.setName('关系')
			.setDesc('可以修改 AI 建议的关系类型。')
			.addText((text) => {
				this.relationInput = text.setValue(suggestion.relation);
			});
		this.contentEl.createEl('label', {
			text: '说明（可以改写）',
			cls: 'haidencyril-field-label',
		});
		this.reasonInput = new TextAreaComponent(this.contentEl).setValue(
			suggestion.reason,
		);
		this.reasonInput.inputEl.rows = 4;
		this.reasonInput.inputEl.addClass('haidencyril-reflection-input');

		const actions = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		const buttons: ButtonComponent[] = [];
		actions.addButton((button) => {
			buttons.push(button);
			button
				.setButtonText('稍后判断')
				.onClick(() => void this.submit('later', buttons));
		});
		actions.addButton((button) => {
			buttons.push(button);
			button
				.setButtonText('不采纳')
				.onClick(() => void this.submit('rejected', buttons));
		});
		actions.addButton((button) => {
			buttons.push(button);
			button
				.setButtonText('确认关联')
				.setCta()
				.onClick(() => void this.submit('accepted', buttons));
		});
		this.relationInput.inputEl.focus();
	}

	private async submit(
		decision: ConnectionDecision,
		buttons: ButtonComponent[],
	): Promise<void> {
		if (this.submitting) {
			return;
		}
		const suggestion = this.suggestions[this.currentIndex];
		if (!suggestion) {
			return;
		}
		const relation = this.relationInput.getValue().trim();
		const reason = this.reasonInput.getValue().trim();
		if (relation.length === 0 || reason.length === 0) {
			new Notice('请保留或填写关系和说明');
			return;
		}

		this.submitting = true;
		buttons.forEach((button) => {
			button.setDisabled(true);
		});
		try {
			await this.onDecision({
				...suggestion,
				decision,
				relation,
				reason,
			});
			this.currentIndex += 1;
			this.submitting = false;
			if (this.currentIndex >= this.suggestions.length) {
				await this.onComplete();
				new Notice('关联建议已审核');
				this.close();
				return;
			}
			this.renderCurrent();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存关联判断失败');
			this.submitting = false;
			buttons.forEach((button) => {
				button.setDisabled(false);
			});
		}
	}
}
