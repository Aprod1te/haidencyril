import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	SearchComponent,
	Setting,
	TFile,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type { ProjectDraft } from '../data/fragment-repository';

export class ProjectPromotionModal extends Modal {
	private readonly selectedPaths: Set<string>;
	private titleInput!: TextComponent;
	private goalInput!: TextAreaComponent;
	private whyNowInput!: TextAreaComponent;
	private successInput!: TextAreaComponent;
	private risksInput!: TextAreaComponent;
	private validationsInput!: TextAreaComponent;
	private actionsInput!: TextAreaComponent;
	private candidateListEl!: HTMLElement;
	private selectedCountEl!: HTMLElement;
	private searchQuery = '';
	private submitting = false;

	constructor(
		app: App,
		private readonly sourceFile: TFile,
		private readonly candidates: TFile[],
		private readonly onSubmit: (draft: ProjectDraft) => Promise<void>,
	) {
		super(app);
		this.selectedPaths = new Set([sourceFile.path]);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-project-modal');
		contentEl.createEl('h2', { text: '把碎片变成项目' });
		contentEl.createEl('p', {
			text: '先由你决定想改变什么。系统只负责把碎片、目标和行动整理到一起。',
			cls: 'haidencyril-muted',
		});

		new Setting(contentEl).setName('项目名称').addText((text) => {
			this.titleInput = text.setValue(this.sourceFile.basename.slice(0, 80));
		});
		this.goalInput = this.addTextArea(
			'你希望实现什么？',
			'写清最终想看到的改变，而不是只写“完成某件事”。',
			4,
		);
		this.whyNowInput = this.addTextArea(
			'为什么现在值得做？（可选）',
			'例如：这个问题反复出现，已经影响活动体验。',
			3,
		);
		this.successInput = this.addTextArea(
			'怎样才算完成？',
			'每行一条可观察的完成标准。',
			3,
		);

		contentEl.createEl('label', {
			text: '项目依据哪些碎片？',
			cls: 'haidencyril-field-label',
		});
		const source = contentEl.createDiv({ cls: 'haidencyril-project-source' });
		source.createEl('strong', { text: this.sourceFile.basename });
		source.createSpan({ text: '起点碎片 · 必选' });
		const selectionHeader = contentEl.createDiv({
			cls: 'haidencyril-project-selection-header',
		});
		const searchHost = selectionHeader.createDiv({
			cls: 'haidencyril-project-search',
		});
		new SearchComponent(searchHost)
			.setPlaceholder('搜索并加入更多碎片…')
			.onChange((value) => {
				this.searchQuery = value.trim().toLocaleLowerCase();
				this.renderCandidates();
			});
		this.selectedCountEl = selectionHeader.createSpan();
		this.candidateListEl = contentEl.createDiv({
			cls: 'haidencyril-project-candidate-list',
		});
		this.renderCandidates();

		this.risksInput = this.addTextArea(
			'目前看见哪些风险？（可选）',
			'每行一条。只记录已经想到的，不必为了填满而猜测。',
			3,
		);
		this.validationsInput = this.addTextArea(
			'开始前还要验证什么？（可选）',
			'每行一个待确认的问题或假设。',
			3,
		);
		this.actionsInput = this.addTextArea(
			'现在可以做的下一步是什么？',
			'每行一个具体动作；日期和日程稍后单独确认。',
			3,
		);

		const actions = new Setting(contentEl).setClass('haidencyril-modal-actions');
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('创建项目')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.goalInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
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

	private renderCandidates(): void {
		this.candidateListEl.empty();
		this.selectedCountEl.setText(`已选 ${this.selectedPaths.size} 条`);
		const visibleCandidates = this.candidates
			.filter((file) => file.path !== this.sourceFile.path)
			.filter(
				(file) =>
					this.searchQuery.length === 0 ||
					file.basename.toLocaleLowerCase().includes(this.searchQuery),
			);
		if (visibleCandidates.length === 0) {
			this.candidateListEl.createEl('p', {
				text: this.candidates.length <= 1 ? '暂时没有其他碎片。' : '没有匹配的碎片。',
				cls: 'haidencyril-muted haidencyril-project-no-results',
			});
			return;
		}

		for (const file of visibleCandidates) {
			new Setting(this.candidateListEl)
				.setName(file.basename)
				.addToggle((toggle) =>
					toggle
						.setValue(this.selectedPaths.has(file.path))
						.onChange((selected) => {
							if (selected) {
								this.selectedPaths.add(file.path);
							} else {
								this.selectedPaths.delete(file.path);
							}
							this.selectedCountEl.setText(`已选 ${this.selectedPaths.size} 条`);
						}),
				);
		}
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		const sourceFiles = [this.sourceFile, ...this.candidates].filter((file) =>
			this.selectedPaths.has(file.path),
		);
		const draft: ProjectDraft = {
			title: this.titleInput.getValue(),
			goal: this.goalInput.getValue(),
			whyNow: this.whyNowInput.getValue(),
			successCriteria: this.lines(this.successInput.getValue()),
			sourceFiles,
			risks: this.lines(this.risksInput.getValue()),
			validations: this.lines(this.validationsInput.getValue()),
			nextActions: this.lines(this.actionsInput.getValue()),
		};

		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit(draft);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '创建项目失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}

	private lines(value: string): string[] {
		return value.split('\n').map((line) => line.trim()).filter(Boolean);
	}
}
