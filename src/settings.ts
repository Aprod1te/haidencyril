import {
	App,
	Notice,
	PluginSettingTab,
	SecretComponent,
	Setting,
} from 'obsidian';
import type HaidencyrilPlugin from './main';

export interface HaidencyrilSettings {
	inboxFolder: string;
	analysisFolder: string;
	projectsFolder: string;
	aiEnabled: boolean;
	apiKeySecretName: string;
	model: string;
	openAnalysisAfterGeneration: boolean;
}

export const DEFAULT_SETTINGS: HaidencyrilSettings = {
	inboxFolder: 'Haidencyril/Inbox',
	analysisFolder: 'Haidencyril/Analysis',
	projectsFolder: 'Haidencyril/Projects',
	aiEnabled: false,
	apiKeySecretName: '',
	model: 'gpt-5.6-terra',
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
			text: '原始笔记始终保存在你的 vault。只有你主动分析时，选中的碎片和最多 4 条候选笔记摘录才会发送给 OpenAI。',
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

		new Setting(containerEl).setName('AI 分析').setHeading();
		new Setting(containerEl)
			.setName('启用 OpenAI 分析')
			.setDesc('关闭时，捕捉和本地浏览仍可正常使用。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.aiEnabled)
					.onChange(async (value) => {
						this.plugin.settings.aiEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('OpenAI API key')
			.setDesc('使用 Obsidian secret storage 加密保存；插件设置只记录密钥名称。')
			.addComponent((element) =>
				new SecretComponent(this.app, element)
					.setValue(this.plugin.settings.apiKeySecretName)
					.onChange(async (value) => {
						this.plugin.settings.apiKeySecretName = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('模型')
			.setDesc('使用支持 responses API 与结构化输出的模型。')
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
		key: 'inboxFolder' | 'analysisFolder' | 'projectsFolder',
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
