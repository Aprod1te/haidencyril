import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type { TaskListItem, TaskPlan } from '../domain/task-plan';

export class TaskPlanningModal extends Modal {
	private goalInput!: TextAreaComponent;
	private constraintsInput!: TextAreaComponent;
	private formEl!: HTMLElement;
	private planEl!: HTMLElement;
	private plan: TaskPlan | null;
	private working = false;

	constructor(
		app: App,
		private readonly initialGoal: string,
		initialTasks: TaskListItem[],
		private readonly onGenerate: (
			goal: string,
			constraints: string,
		) => Promise<TaskPlan>,
		private readonly onSave: (tasks: TaskListItem[]) => Promise<void>,
		private readonly onSchedule: (
			task: TaskListItem,
			tasks: TaskListItem[],
		) => Promise<void>,
	) {
		super(app);
		this.plan =
			initialTasks.length > 0
				? { goal: initialGoal, questions: [], tasks: initialTasks }
				: null;
	}

	onOpen(): void {
		this.modalEl.addClass('haidencyril-task-planning-shell');
		this.contentEl.addClass('haidencyril-task-planning-modal');
		this.contentEl.createEl('h2', { text: '把碎片整理成任务清单' });
		this.contentEl.createEl('p', {
			text: '先确认你想得到的结果，再让系统提出可修改的执行步骤。日期不会被自动决定。',
			cls: 'haidencyril-muted',
		});
		this.formEl = this.contentEl.createDiv({ cls: 'haidencyril-task-form' });
		this.formEl.createEl('label', {
			text: '你希望完成什么？',
			cls: 'haidencyril-field-label',
		});
		this.goalInput = new TextAreaComponent(this.formEl).setValue(
			this.initialGoal,
		);
		this.goalInput.inputEl.rows = 3;
		this.goalInput.inputEl.addClass('haidencyril-reflection-input');
		this.formEl.createEl('label', {
			text: '有哪些限制或不确定点？（可选）',
			cls: 'haidencyril-field-label',
		});
		this.constraintsInput = new TextAreaComponent(this.formEl).setPlaceholder(
			'例如：14 号指哪一天、制作周期还没确认、预算未知。',
		);
		this.constraintsInput.inputEl.rows = 3;
		this.constraintsInput.inputEl.addClass('haidencyril-reflection-input');

		const actions = new Setting(this.formEl).setClass(
			'haidencyril-modal-actions',
		);
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText(this.plan ? '重新整理' : '生成任务清单')
				.setCta()
				.onClick(() => void this.generate(button)),
		);
		this.planEl = this.contentEl.createDiv({ cls: 'haidencyril-task-plan' });
		if (this.plan) {
			this.formEl.addClass('is-hidden');
		}
		this.renderPlan();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async generate(button: ButtonComponent): Promise<void> {
		if (this.working) {
			return;
		}
		const goal = this.goalInput.getValue().trim();
		if (!goal) {
			new Notice('先确认你希望完成什么');
			return;
		}
		this.working = true;
		button.setDisabled(true);
		try {
			this.plan = await this.onGenerate(
				goal,
				this.constraintsInput.getValue().trim(),
			);
			this.formEl.addClass('is-hidden');
			this.renderPlan();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '生成任务清单失败');
		} finally {
			this.working = false;
			button.setDisabled(false);
		}
	}

	private renderPlan(): void {
		this.planEl.empty();
		if (!this.plan) {
			return;
		}
		const revise = this.planEl.createEl('button', {
			text: '修改目标或限制后重新整理',
			cls: 'haidencyril-link-button haidencyril-task-revise',
		});
		revise.addEventListener('click', () => {
			this.formEl.removeClass('is-hidden');
			this.planEl.empty();
			this.goalInput.inputEl.focus();
		});
		if (this.plan.questions.length > 0) {
			const questions = this.planEl.createDiv({
				cls: 'haidencyril-task-questions',
			});
			questions.createEl('strong', { text: '安排前仍需你确认' });
			for (const question of this.plan.questions) {
				questions.createEl('p', { text: question });
			}
		}
		this.planEl.createEl('h3', { text: '可执行任务清单' });
		const list = this.planEl.createDiv({ cls: 'haidencyril-task-list' });
		for (const [index, task] of this.plan.tasks.entries()) {
			const row = list.createDiv({ cls: 'haidencyril-task-row' });
			const content = row.createDiv();
			content.createEl('strong', { text: `第 ${index + 1} 步` });
			new TextComponent(content)
				.setValue(task.action)
				.setPlaceholder('具体行动')
				.onChange((value) => {
					task.action = value;
				});
			new TextComponent(content)
				.setValue(task.doneWhen)
				.setPlaceholder('可观察的完成标准')
				.onChange((value) => {
					task.doneWhen = value;
				});
			const schedule = row.createEl('button', { text: '安排这一项' });
			schedule.addEventListener('click', () =>
				void this.schedule(task, schedule),
			);
		}
		const save = new Setting(this.planEl).setClass('haidencyril-modal-actions');
		save.addButton((button) =>
			button.setButtonText('只保存任务清单').onClick(() => void this.save(button)),
		);
	}

	private async save(button: ButtonComponent): Promise<void> {
		if (!this.plan || this.working) {
			return;
		}
		const tasks = this.validTasks();
		if (!tasks) {
			return;
		}
		this.working = true;
		button.setDisabled(true);
		try {
			await this.onSave(tasks);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存任务清单失败');
			this.working = false;
			button.setDisabled(false);
		}
	}

	private async schedule(
		task: TaskListItem,
		button: HTMLButtonElement,
	): Promise<void> {
		if (!this.plan || this.working) {
			return;
		}
		const tasks = this.validTasks();
		if (!tasks) {
			return;
		}
		const selected = tasks[this.plan.tasks.indexOf(task)];
		if (!selected) {
			return;
		}
		this.working = true;
		button.disabled = true;
		try {
			await this.onSchedule(selected, tasks);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '打开日程安排失败');
			this.working = false;
			button.disabled = false;
		}
	}

	private validTasks(): TaskListItem[] | null {
		if (!this.plan) {
			return null;
		}
		const tasks = this.plan.tasks.map((task) => ({
			action: task.action.trim(),
			doneWhen: task.doneWhen.trim(),
			completed: (task as TaskListItem).completed,
		}));
		if (tasks.some((task) => !task.action || !task.doneWhen)) {
			new Notice('每一步都需要具体行动和完成标准');
			return null;
		}
		return tasks;
	}
}
