import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
} from 'obsidian';
import type {
	TaskCompletionReflection,
	VaultTask,
} from '../data/task-repository';

export class TaskCompletionModal extends Modal {
	private outcomeInput!: TextAreaComponent;
	private obstacleInput!: TextAreaComponent;
	private adjustmentInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly task: VaultTask,
		private readonly onSubmit: (
			reflection: TaskCompletionReflection,
		) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-task-completion-modal');
		this.contentEl.createEl('h2', { text: '完成任务并留下执行记录' });
		this.contentEl.createEl('p', {
			text: this.task.action,
			cls: 'haidencyril-project-source',
		});
		if (this.task.doneWhen) {
			this.contentEl.createEl('p', {
				text: `原完成标准：${this.task.doneWhen}`,
				cls: 'haidencyril-muted',
			});
		}
		this.outcomeInput = this.addInput(
			'实际结果',
			'写下可观察的结果，不必把偏差解释成成功。',
			4,
		);
		this.obstacleInput = this.addInput(
			'阻碍或偏差（可选）',
			'什么和原计划不一样？',
			3,
		);
		this.adjustmentInput = this.addInput(
			'下次调整（可选）',
			'下一次保留什么，或改变什么？',
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
				.setButtonText('保存记录并完成')
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
		const outcome = this.outcomeInput.getValue().trim();
		if (!outcome) {
			new Notice('先写下实际结果');
			return;
		}
		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({
				outcome,
				obstacle: this.obstacleInput.getValue().trim(),
				adjustment: this.adjustmentInput.getValue().trim(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存执行记录失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
