import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import type HaidencyrilPlugin from './main';

export interface HaidencyrilSettings {
	inboxFolder: string;
	analysisFolder: string;
	projectsFolder: string;
	scheduleFolder: string;
	aiEnabled: boolean;
	model: string;
	embeddingModel: string;
	calendarShortcutName: string;
	openAnalysisAfterGeneration: boolean;
}

export const DEFAULT_SETTINGS: HaidencyrilSettings = {
	inboxFolder: 'Haidencyril/Inbox',
	analysisFolder: 'Haidencyril/Analysis',
	projectsFolder: 'Haidencyril/Projects',
	scheduleFolder: 'Haidencyril/Schedule',
	aiEnabled: true,
	model: 'qwen3.5:9b',
	embeddingModel: 'qwen3-embedding:0.6b',
	calendarShortcutName: 'Haidencyril 日程',
	openAnalysisAfterGeneration: true,
};

export class HaidencyrilSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: HaidencyrilPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('基础设置').setHeading();
		containerEl.createEl('p', {
			text: '分析在这台电脑本地完成。原始笔记和候选摘录不会发送到云端。',
			cls: 'setting-item-description',
		});

		new Setting(containerEl).setName('知识库目录').setHeading();
		this.addFolderSetting('收件箱', '快捷记录和待处理碎片。', 'inboxFolder');
		this.addFolderSetting(
			'分析账本',
			'系统生成的可追溯分析记录。',
			'analysisFolder',
		);
		this.addFolderSetting('项目', '由碎片逐渐形成的项目。', 'projectsFolder');
		this.addFolderSetting('日程', '导入课表、日程草案和确认记录。', 'scheduleFolder');

		new Setting(containerEl).setName('AI 分析').setHeading();
		new Setting(containerEl)
			.setName('启用本地 AI 分析')
			.setDesc('需要在这台电脑上运行本地模型服务；关闭后仍可记录和浏览碎片。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.aiEnabled)
					.onChange(async (value) => {
						this.plugin.settings.aiEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('本地模型')
			.setDesc('Ollama 模型名称。当前设备推荐 qwen3.5:9b。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.model)
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('语义检索模型')
			.setDesc('本地嵌入模型，默认版本约 639 兆字节。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.embeddingModel)
					.setValue(this.plugin.settings.embeddingModel)
					.onChange(async (value) => {
						this.plugin.settings.embeddingModel =
							value.trim() || DEFAULT_SETTINGS.embeddingModel;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('苹果自动化').setHeading();
		new Setting(containerEl)
			.setName('日历快捷指令名称')
			.setDesc('确认日程后调用的苹果快捷指令；留空则只保存 Markdown 草案。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.calendarShortcutName)
					.setValue(this.plugin.settings.calendarShortcutName)
					.onChange(async (value) => {
						this.plugin.settings.calendarShortcutName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('生成后打开分析')
			.setDesc('生成分析账本后立即打开对应笔记。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openAnalysisAfterGeneration)
					.onChange(async (value) => {
						this.plugin.settings.openAnalysisAfterGeneration = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('重新打开工作台')
			.setDesc('设置发生变化后可用它刷新目录和状态。')
			.addButton((button) =>
				button.setButtonText('打开').onClick(() => {
					void this.plugin.activateWorkspace();
					new Notice('Haidencyril 工作台已打开');
				}),
			);
	}

	private addFolderSetting(
		name: string,
		description: string,
		key:
			| 'inboxFolder'
			| 'analysisFolder'
			| 'projectsFolder'
			| 'scheduleFolder',
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) =>
				text
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						const trimmed = value.trim().replace(/^\/+|\/+$/gu, '');
						if (trimmed.length > 0) {
							this.plugin.settings[key] = trimmed;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
