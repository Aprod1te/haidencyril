import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
} from 'obsidian';
import type { TemporaryBlockDraft } from '../domain/schedule';

export class TemporaryBlockModal extends Modal {
	private titleInput!: TextComponent;
	private startInput!: TextComponent;
	private endInput!: TextComponent;
	private locationInput!: TextComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly initialTitle: string,
		private readonly onSubmit: (draft: TemporaryBlockDraft) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-temporary-block-modal');
		this.contentEl.createEl('h2', { text: '设为临时固定安排' });
		this.contentEl.createEl('p', {
			text: '适合临时补课、必须参加的会议或其他不应被日程建议占用的时间。',
			cls: 'haidencyril-muted',
		});
		new Setting(this.contentEl).setName('安排').addText((text) => {
			this.titleInput = text.setValue(this.initialTitle);
		});
		const start = this.defaultStart();
		const end = new Date(start.getTime() + 60 * 60_000);
		new Setting(this.contentEl)
			.setName('开始时间')
			.setDesc('日期和时间由你最终确认。')
			.addText((text) => {
				this.startInput = text.setValue(this.toLocalInput(start));
				this.startInput.inputEl.type = 'datetime-local';
			});
		new Setting(this.contentEl).setName('结束时间').addText((text) => {
			this.endInput = text.setValue(this.toLocalInput(end));
			this.endInput.inputEl.type = 'datetime-local';
		});
		new Setting(this.contentEl).setName('地点（可选）').addText((text) => {
			this.locationInput = text.setPlaceholder('例如：礼堂 201');
		});
		this.contentEl.createEl('p', {
			text: '保存后会写入本地 Markdown 账本，并作为日程冲突检查的受保护时间。',
			cls: 'haidencyril-muted',
		});
		const actions = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('确认为固定安排')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.titleInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		const title = this.titleInput.getValue().trim();
		const start = new Date(this.startInput.getValue());
		const end = new Date(this.endInput.getValue());
		if (!title) {
			new Notice('请先确认安排名称');
			return;
		}
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			new Notice('请填写完整的开始和结束时间');
			return;
		}
		if (end <= start) {
			new Notice('结束时间必须晚于开始时间');
			return;
		}
		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({
				title,
				start,
				end,
				location: this.locationInput.getValue().trim(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存固定安排失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}

	private defaultStart(): Date {
		const value = new Date();
		value.setSeconds(0, 0);
		value.setMinutes(value.getMinutes() < 30 ? 30 : 60);
		return value;
	}

	private toLocalInput(value: Date): string {
		const offset = value.getTimezoneOffset() * 60_000;
		return new Date(value.getTime() - offset).toISOString().slice(0, 16);
	}
}
