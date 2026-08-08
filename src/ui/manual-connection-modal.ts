import {
	App,
	ButtonComponent,
	FuzzySuggestModal,
	Modal,
	Notice,
	normalizePath,
	Setting,
	TFile,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';

export interface ManualConnectionSubmission {
	relation: string;
	reason: string;
}

export class ManualConnectionTargetModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly sourceFile: TFile,
		private readonly analysisFolder: string,
		private readonly onChoose: (targetFile: TFile) => void,
	) {
		super(app);
		this.setPlaceholder('搜索要关联的笔记…');
	}

	getItems(): TFile[] {
		const analysisPrefix = `${normalizePath(this.analysisFolder)}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path !== this.sourceFile.path)
			.filter((file) => !file.path.startsWith(analysisPrefix))
			.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

export class ManualConnectionModal extends Modal {
	private relationInput!: TextComponent;
	private reasonInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly targetFile: TFile,
		private readonly onSubmit: (
			submission: ManualConnectionSubmission,
		) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-connection-modal');
		contentEl.createEl('h2', { text: '说明这两条笔记的联系' });
		contentEl.createEl('p', {
			text: this.targetFile.basename,
			cls: 'haidencyril-connection-target',
		});

		new Setting(contentEl)
			.setName('关系')
			.setDesc('用一个短语说明联系类型。')
			.addText((text) => {
				this.relationInput = text
					.setPlaceholder('例如：补充、因果、相似、冲突')
					.setValue('相关');
			});

		contentEl.createEl('label', {
			text: '为什么有关联？',
			cls: 'haidencyril-field-label',
		});
		this.reasonInput = new TextAreaComponent(contentEl).setPlaceholder(
			'写下判断依据，避免以后只看见连线却忘了原因。',
		);
		this.reasonInput.inputEl.rows = 4;
		this.reasonInput.inputEl.addClass('haidencyril-reflection-input');

		const actions = new Setting(contentEl).setClass('haidencyril-modal-actions');
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('建立关联')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.reasonInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		const relation = this.relationInput.getValue().trim();
		const reason = this.reasonInput.getValue().trim();
		if (relation.length === 0) {
			new Notice('请填写关系类型');
			return;
		}
		if (reason.length === 0) {
			new Notice('请写下关联原因');
			return;
		}

		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({ relation, reason });
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '建立关联失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
