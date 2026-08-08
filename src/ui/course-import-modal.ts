import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';

export class CourseImportModal extends Modal {
	private content = '';
	private sourceName = '';
	private selectionEl!: HTMLElement;
	private submitting = false;

	constructor(
		app: App,
		private readonly onSubmit: (
			content: string,
			sourceName: string,
		) => Promise<number>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('haidencyril-course-import-modal');
		this.contentEl.createEl('h2', { text: '导入 .ics 固定日程' });
		this.contentEl.createEl('p', {
			text: '从教务系统或苹果日历导出 .ics 文件。插件不登录教务系统，也不保存账号密码。',
			cls: 'haidencyril-muted',
		});
		const picker = this.contentEl.createEl('input');
		picker.type = 'file';
		picker.accept = '.ics,text/calendar';
		picker.addClass('haidencyril-hidden-input');
		picker.addEventListener('change', () => {
			const file = picker.files?.[0];
			if (!file) {
				return;
			}
			void file.text().then((content) => {
				this.content = content;
				this.sourceName = file.name;
				this.selectionEl.setText(`已选择：${file.name}`);
			});
		});
		const choose = new Setting(this.contentEl)
			.setName('日历文件')
			.setDesc('支持标准日历文件和重复日程。');
		choose.addButton((button) =>
			button.setButtonText('选择 .ics 文件').onClick(() => picker.click()),
		);
		this.selectionEl = this.contentEl.createEl('p', {
			text: '尚未选择文件',
			cls: 'haidencyril-course-selection',
		});

		const actions = new Setting(this.contentEl).setClass(
			'haidencyril-modal-actions',
		);
		actions.addButton((button) =>
			button.setButtonText('取消').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('确认导入')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		if (!this.content) {
			new Notice('请先选择 .ics 文件');
			return;
		}
		this.submitting = true;
		button.setDisabled(true);
		try {
			const count = await this.onSubmit(this.content, this.sourceName);
			new Notice(`已导入 ${count} 条固定安排`);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '导入 .ics 失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
