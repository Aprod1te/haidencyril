import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
} from 'obsidian';
import type { ProjectReview } from '../data/fragment-repository';

export class ProjectReviewModal extends Modal {
	private outcomeInput!: TextAreaComponent;
	private evidenceInput!: TextAreaComponent;
	private lessonsInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly projectTitle: string,
		private readonly onSubmit: (review: ProjectReview) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-project-review-modal');
		this.contentEl.createEl('h2', { text: '完成项目并复盘' });
		this.contentEl.createEl('p', {
			text: this.projectTitle,
			cls: 'haidencyril-project-source',
		});
		this.contentEl.createEl('p', {
			text: '复盘记录实际结果，不要求把原计划解释成成功。',
			cls: 'haidencyril-muted',
		});
		this.outcomeInput = this.addInput(
			'实际发生了什么？',
			'结果、偏差和没有完成的部分都可以写。',
			5,
		);
		this.evidenceInput = this.addInput(
			'有什么可核对的依据？（可选）',
			'例如反馈、数据、现场观察或产出物。',
			3,
		);
		this.lessonsInput = this.addInput(
			'以后应该保留或改变什么？',
			'写下下一次还能复用的经验。',
			4,
		);
		const actions = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('保存复盘并完成')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.outcomeInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private addInput(
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
				outcome: this.outcomeInput.getValue(),
				evidence: this.evidenceInput.getValue(),
				lessons: this.lessonsInput.getValue(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存复盘失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
