import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
} from 'obsidian';
import type {
	ActionProposal,
	ReminderProposal,
	ScheduleDestination,
	ScheduleProposal,
	ScheduleRequest,
	TaskPriority,
} from '../domain/schedule';

export class ScheduleModal extends Modal {
	private taskInput!: TextComponent;
	private deadlineInput!: TextComponent;
	private durationMinutes = 60;
	private priority: TaskPriority = 'normal';
	private destination: ScheduleDestination = 'calendar';
	private durationSetting!: Setting;
	private prioritySetting!: Setting;
	private deadlineSetting!: Setting;
	private proposalEl!: HTMLElement;
	private working = false;

	constructor(
		app: App,
		private readonly initialTask: string,
		private readonly onGenerate: (
			request: ScheduleRequest,
		) => Promise<ScheduleProposal | null>,
		private readonly onConfirm: (proposal: ActionProposal) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-schedule-modal');
		this.contentEl.createEl('h2', { text: '安排日程提醒' });
		this.contentEl.createEl('p', {
			text: '课程优先受到保护。所有日期、冲突和写入内容都会在这里确认。',
			cls: 'haidencyril-muted',
		});
		new Setting(this.contentEl).setName('行动').addText((text) => {
			this.taskInput = text.setValue(this.initialTask);
		});
		new Setting(this.contentEl)
			.setName('安排方式')
			.setDesc('占用时间的行动放进日历；只需到点提醒的事项放进提醒事项。')
			.addDropdown((dropdown: DropdownComponent) =>
				dropdown
					.addOption('calendar', '日历时间块')
					.addOption('reminder', '提醒事项')
					.setValue('calendar')
					.onChange((value) => {
						this.destination = value === 'reminder' ? 'reminder' : 'calendar';
						this.updateDestinationFields();
					}),
			);
		this.durationSetting = new Setting(this.contentEl)
			.setName('预计用时')
			.addDropdown((dropdown: DropdownComponent) =>
				dropdown
					.addOption('30', '30 分钟')
					.addOption('60', '1 小时')
					.addOption('90', '1.5 小时')
					.addOption('120', '2 小时')
					.setValue('60')
					.onChange((value) => {
						this.durationMinutes = Number(value);
					}),
			);
		this.prioritySetting = new Setting(this.contentEl)
			.setName('优先级')
			.setDesc('高优先级只有在找不到空闲时间时才会提出占用课程。')
			.addDropdown((dropdown: DropdownComponent) =>
				dropdown
					.addOption('normal', '普通')
					.addOption('high', '高')
					.setValue('normal')
					.onChange((value) => {
						this.priority = value === 'high' ? 'high' : 'normal';
					}),
			);
		this.deadlineSetting = new Setting(this.contentEl)
			.setName('最晚完成时间')
			.setDesc('这是安排边界，不会被静默保存为截止日期。')
			.addText((text) => {
				this.deadlineInput = text;
				text.inputEl.type = 'datetime-local';
				text.setValue(this.defaultDeadline());
			});
		const generate = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		generate.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		generate.addButton((button) =>
			button
				.setButtonText('生成可确认草案')
				.setCta()
				.onClick(() => void this.generate(button)),
		);
		this.proposalEl = this.contentEl.createDiv({
			cls: 'haidencyril-schedule-proposal',
		});
		this.updateDestinationFields();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async generate(button: ButtonComponent): Promise<void> {
		if (this.working) {
			return;
		}
		const title = this.taskInput.getValue().trim();
		const deadline = new Date(this.deadlineInput.getValue());
		if (!title) {
			new Notice('请写下要安排的行动');
			return;
		}
		if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
			new Notice('请确认一个未来的最晚完成时间');
			return;
		}
		this.working = true;
		button.setDisabled(true);
		try {
			const proposal: ActionProposal | null =
				this.destination === 'reminder'
					? ({ destination: 'reminder', title, due: deadline } satisfies ReminderProposal)
					: await this.onGenerate({
							title,
							durationMinutes: this.durationMinutes,
							deadline,
							priority: this.priority,
						});
			this.renderProposal(proposal);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '生成日程草案失败');
		} finally {
			this.working = false;
			button.setDisabled(false);
		}
	}

	private renderProposal(proposal: ActionProposal | null): void {
		this.proposalEl.empty();
		if (!proposal) {
			this.proposalEl.createEl('p', {
				text: '在截止时间前没有找到不冲突的完整时间。可以延后截止时间，或明确改为高优先级后重新生成。',
				cls: 'haidencyril-error',
			});
			return;
		}
		this.proposalEl.createEl('h3', { text: '写入前确认' });
		const formatter = new Intl.DateTimeFormat('zh-CN', {
			weekday: 'short',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
		if (proposal.destination === 'reminder') {
			this.proposalEl.createEl('p', {
				text: `提醒时间：${formatter.format(proposal.due)}`,
				cls: 'haidencyril-schedule-time',
			});
			const reminderSetting = new Setting(this.proposalEl).setClass(
				'haidencyril-modal-actions',
			);
			reminderSetting.addButton((button) =>
				button
					.setButtonText('确认并交给提醒事项')
					.setCta()
					.onClick(() => void this.confirm(proposal, button)),
			);
			return;
		}
		this.proposalEl.createEl('p', {
			text: `${formatter.format(proposal.start)} → ${formatter.format(proposal.end)}`,
			cls: 'haidencyril-schedule-time',
		});
		if (proposal.conflicts.length > 0) {
			const warning = this.proposalEl.createDiv({
				cls: 'haidencyril-schedule-warning',
			});
			warning.createEl('strong', { text: '将占用受保护的课程时间' });
			for (const conflict of proposal.conflicts) {
				warning.createEl('p', { text: conflict.title });
			}
		}
		const setting = new Setting(this.proposalEl).setClass(
			'haidencyril-modal-actions',
		);
		setting.addButton((button) => {
			button.setButtonText(
				proposal.conflicts.length > 0
					? '我确认代价并继续'
					: '确认并交给苹果日历',
			);
			if (proposal.conflicts.length > 0) {
				button.buttonEl.addClass('mod-warning');
			} else {
				button.setCta();
			}
			button.onClick(() => void this.confirm(proposal, button));
		});
	}

	private async confirm(
		proposal: ActionProposal,
		button: ButtonComponent,
	): Promise<void> {
		if (this.working) {
			return;
		}
		this.working = true;
		button.setDisabled(true);
		try {
			await this.onConfirm(proposal);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存日程失败');
			this.working = false;
			button.setDisabled(false);
		}
	}

	private updateDestinationFields(): void {
		const isReminder = this.destination === 'reminder';
		this.durationSetting.settingEl.toggleClass('is-hidden', isReminder);
		this.prioritySetting.settingEl.toggleClass('is-hidden', isReminder);
		this.deadlineSetting
			.setName(isReminder ? '提醒时间' : '最晚完成时间')
			.setDesc(
				isReminder
					? '确认后创建提醒事项，不占用日历时间。'
					: '这是安排边界，不会被静默保存为截止日期。',
			);
	}

	private defaultDeadline(): string {
		const value = new Date();
		value.setDate(value.getDate() + 1);
		value.setHours(22, 0, 0, 0);
		const offset = value.getTimezoneOffset() * 60_000;
		return new Date(value.getTime() - offset).toISOString().slice(0, 16);
	}
}
