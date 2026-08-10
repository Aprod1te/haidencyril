import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type {
	ThemeEvolutionDraft,
	ThemeSummary,
} from '../data/theme-repository';

export class ThemeEvolutionModal extends Modal {
	private selectedTheme: ThemeSummary | null = null;
	private titleInput!: TextComponent;
	private patternInput!: TextAreaComponent;
	private changeInput!: TextAreaComponent;
	private questionInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly projectTitle: string,
		private readonly themes: ThemeSummary[],
		private readonly onSubmit: (draft: ThemeEvolutionDraft) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-theme-modal');
		this.contentEl.createEl('h2', { text: '把复盘沉淀为长期主题' });
		this.contentEl.createEl('p', {
			text: this.projectTitle,
			cls: 'haidencyril-project-source',
		});
		this.contentEl.createEl('p', {
			text: '先由你判断这是不是反复出现的模式。系统负责保存时间线和来源，不把一次经历自动概括成长期规律。',
			cls: 'haidencyril-muted',
		});

		if (this.themes.length > 0) {
			new Setting(this.contentEl)
				.setName('记录到哪里')
				.setDesc('更新已有主题，或新建一个主题。')
				.addDropdown((dropdown) => this.configureThemePicker(dropdown));
		}
		new Setting(this.contentEl).setName('主题名称').addText((text) => {
			this.titleInput = text.setPlaceholder('例如：活动信息传达方式');
		});
		this.patternInput = this.addTextArea(
			'这次看见了什么反复模式？',
			'写成目前可以被后续经历支持或推翻的判断。',
			4,
		);
		this.changeInput = this.addTextArea(
			'和过去相比有什么变化？（可选）',
			'第一次记录可以留空；更新主题时写清增强、减弱或出现的新条件。',
			3,
		);
		this.questionInput = this.addTextArea(
			'下次还要观察什么？',
			'留下一个能帮助你验证或反驳当前理解的问题。',
			3,
		);
		const actions = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('确认沉淀')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.titleInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private configureThemePicker(dropdown: DropdownComponent): void {
		dropdown.addOption('new', '新建主题');
		this.themes.forEach((theme, index) => {
			dropdown.addOption(index.toString(), theme.title);
		});
		dropdown.onChange((value) => {
			this.selectedTheme = value === 'new' ? null : this.themes[Number(value)] ?? null;
			this.titleInput
				.setValue(this.selectedTheme?.title ?? '')
				.setDisabled(this.selectedTheme !== null);
			if (this.selectedTheme && !this.patternInput.getValue().trim()) {
				this.patternInput.setValue(this.selectedTheme.statement);
			}
		});
	}

	private addTextArea(
		label: string,
		placeholder: string,
		rows: number,
	): TextAreaComponent {
		this.contentEl.createEl('label', {
			text: label,
			cls: 'haidencyril-field-label',
		});
		const input = new TextAreaComponent(this.contentEl).setPlaceholder(placeholder);
		input.inputEl.rows = rows;
		input.inputEl.addClass('haidencyril-reflection-input');
		return input;
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({
				themeFile: this.selectedTheme?.file ?? null,
				title: this.titleInput.getValue(),
				pattern: this.patternInput.getValue(),
				change: this.changeInput.getValue(),
				nextQuestion: this.questionInput.getValue(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存长期主题失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
