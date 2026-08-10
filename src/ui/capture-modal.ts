import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Platform,
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
		this.containerEl.addClass('haidencyril-capture-container');
		this.modalEl.addClass('haidencyril-capture-shell');
		contentEl.addClass('haidencyril-capture-modal');
		contentEl.createEl('h2', { text: '记录一个碎片' });
		contentEl.createEl('p', {
			text: '先把它留下，不需要现在分类或整理。',
			cls: 'haidencyril-muted',
		});
		if (Platform.isMobileApp) {
			new Setting(contentEl)
				.setClass('haidencyril-modal-actions')
				.setClass('haidencyril-mobile-save-action')
				.addButton((button) =>
					button
						.setButtonText('保存碎片')
						.setCta()
						.onClick(() => {
							void this.submit(false, button);
						}),
				);
		}

		this.input = new TextAreaComponent(contentEl)
			.setPlaceholder('一个想法、现场发现的问题、别人模糊的反馈……');
		this.input.inputEl.rows = Platform.isMobileApp ? 6 : 10;
		this.input.inputEl.addClass('haidencyril-capture-input');
		this.input.inputEl.focus();

		if (!Platform.isMobileApp) {
			const actions = new Setting(contentEl).setClass(
				'haidencyril-modal-actions',
			);
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
					button.setTooltip('请先在设置中启用本地 AI');
				}
			});
		}

		contentEl.createEl('p', {
			text: Platform.isMobileApp
				? '保存后会通过 iCloud 同步到 Mac，再进入待分析队列。'
				: '“保存并分析”只会把本碎片和最多 4 条候选笔记交给这台电脑上的本地模型。',
			cls: 'haidencyril-privacy-note',
		});
	}

	onClose(): void {
		this.containerEl.removeClass('haidencyril-capture-container');
		this.modalEl.removeClass('haidencyril-capture-shell');
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
