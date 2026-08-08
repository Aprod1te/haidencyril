import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
} from 'obsidian';
import type { UserReflection } from '../domain/analysis';

export class ReflectionModal extends Modal {
	private currentViewInput!: TextAreaComponent;
	private uncertaintyInput!: TextAreaComponent;
	private submitting = false;

	constructor(
		app: App,
		private readonly onSubmit: (reflection: UserReflection) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-reflection-modal');
		contentEl.createEl('h2', { text: '先留下你的判断' });
		contentEl.createEl('p', {
			text: '系统会在你表达之后再分析，并明确指出支持、冲突和未知之处。',
			cls: 'haidencyril-muted',
		});

		contentEl.createEl('label', {
			text: '你目前怎么看这件事？',
			cls: 'haidencyril-field-label',
		});
		this.currentViewInput = new TextAreaComponent(contentEl).setPlaceholder(
			'不要求成熟。可以写你怀疑的原因、在意的结果，或者第一反应。',
		);
		this.currentViewInput.inputEl.rows = 6;
		this.currentViewInput.inputEl.addClass('haidencyril-reflection-input');

		contentEl.createEl('label', {
			text: '你最不确定的是什么？（可选）',
			cls: 'haidencyril-field-label',
		});
		this.uncertaintyInput = new TextAreaComponent(contentEl).setPlaceholder(
			'例如：我不知道这条反馈代表个别感受，还是活动设计真的有问题。',
		);
		this.uncertaintyInput.inputEl.rows = 3;
		this.uncertaintyInput.inputEl.addClass('haidencyril-reflection-input');

		const actions = new Setting(contentEl).setClass('haidencyril-modal-actions');
		actions.addButton((button) =>
			button.setButtonText('暂不分析').onClick(() => this.close()),
		);
		actions.addButton((button) =>
			button
				.setButtonText('生成对照分析')
				.setCta()
				.onClick(() => void this.submit(button)),
		);
		this.currentViewInput.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(button: ButtonComponent): Promise<void> {
		if (this.submitting) {
			return;
		}
		const currentView = this.currentViewInput.getValue().trim();
		if (currentView.length === 0) {
			new Notice('先写下你的初步判断；不成熟也没有关系');
			return;
		}

		this.submitting = true;
		button.setDisabled(true);
		try {
			await this.onSubmit({
				currentView,
				uncertainty: this.uncertaintyInput.getValue().trim(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '分析失败');
			this.submitting = false;
			button.setDisabled(false);
		}
	}
}
