import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
} from 'obsidian';

export interface CaptureSubmission {
	content: string;
	analyze: boolean;
}

export class CaptureModal extends Modal {
	private input!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly aiAvailable: boolean,
		private readonly onSubmit: (submission: CaptureSubmission) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-capture-modal');
		contentEl.createEl('h2', { text: '记录一个碎片' });
		contentEl.createEl('p', {
			text: '先把它留下，不需要现在分类或整理。',
			cls: 'haidencyril-muted',
		});

		this.input = new TextAreaComponent(contentEl)
			.setPlaceholder('一个想法、现场发现的问题、别人模糊的反馈……');
		this.input.inputEl.rows = 10;
		this.input.inputEl.addClass('haidencyril-capture-input');
		this.input.inputEl.focus();

		const actions = new Setting(contentEl).setClass('haidencyril-modal-actions');
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button.setButtonText('仅保存').onClick(() => {
				void this.submit(false, button);
			}),
		);
		actions.addButton((button) => {
			button
				.setButtonText('保存并分析')
				.setCta()
				.setDisabled(!this.aiAvailable)
				.onClick(() => {
					void this.submit(true, button);
				});
			if (!this.aiAvailable) {
				button.setTooltip('请先在设置中启用 AI 并选择 API key');
			}
		});

		contentEl.createEl('p', {
			text: '“保存并分析”会把本碎片和最多 4 条本地候选笔记摘录发送给 OpenAI。',
			cls: 'haidencyril-privacy-note',
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(analyze: boolean, button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		const content = this.input.getValue().trim();
		if (content.length === 0) {
			new Notice('先写下一点内容');
			return;
		}

		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({ content, analyze });
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
