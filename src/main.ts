import { Notice, Plugin, TFile } from 'obsidian';
import { FragmentRepository } from './data/fragment-repository';
import {
	DEFAULT_SETTINGS,
	HaidencyrilSettingTab,
	type HaidencyrilSettings,
} from './settings';
import { OpenAIAnalysisService } from './services/openai-analysis-service';
import { CaptureModal, type CaptureSubmission } from './ui/capture-modal';
import type { UserReflection } from './domain/analysis';
import { ReflectionModal } from './ui/reflection-modal';
import {
	HAIDENCYRIL_VIEW_TYPE,
	HaidencyrilWorkspaceView,
} from './ui/workspace-view';

export default class HaidencyrilPlugin extends Plugin {
	settings!: HaidencyrilSettings;
	repository!: FragmentRepository;
	private analysisService!: OpenAIAnalysisService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.repository = new FragmentRepository(this.app, () => this.settings);
		this.analysisService = new OpenAIAnalysisService();

		this.registerView(
			HAIDENCYRIL_VIEW_TYPE,
			(leaf) => new HaidencyrilWorkspaceView(leaf, this),
		);
		this.addRibbonIcon('sparkles', '打开工作台', () => {
			void this.activateWorkspace();
		});
		this.addCommand({
			id: 'open-workspace',
			name: '打开工作台',
			callback: () => void this.activateWorkspace(),
		});
		this.addCommand({
			id: 'capture-fragment',
			name: '记录一个碎片',
			callback: () => this.openCaptureModal(),
		});
		this.addSettingTab(new HaidencyrilSettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on('create', () => {
				void this.refreshWorkspace();
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', () => {
				void this.refreshWorkspace();
			}),
		);
	}

	async activateWorkspace(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(HAIDENCYRIL_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: HAIDENCYRIL_VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	openCaptureModal(): void {
		new CaptureModal(
			this.app,
			this.settings.aiEnabled && this.settings.apiKeySecretName.length > 0,
			(submission) => this.handleCapture(submission),
		).open();
	}

	openReflectionModal(file: TFile): void {
		if (!this.settings.aiEnabled || this.settings.apiKeySecretName.length === 0) {
			new Notice('请先在插件设置中启用 AI 并选择 API key');
			return;
		}
		new ReflectionModal(this.app, (reflection) =>
			this.analyzeFragment(file, reflection).then(() => undefined),
		).open();
	}

	async analyzeFragment(file: TFile, reflection: UserReflection): Promise<TFile> {
		if (!this.settings.aiEnabled) {
			throw new Error('请先在 Haidencyril 设置中启用 OpenAI 分析');
		}
		const apiKey = this.app.secretStorage.getSecret(this.settings.apiKeySecretName);
		if (!apiKey) {
			throw new Error('请先在 Haidencyril 设置中选择有效的 OpenAI API Key');
		}

		new Notice('正在形成可核对的分析账本…');
		const content = await this.repository.readBody(file);
		const candidates = await this.repository.findConnectionCandidates(file, content);
		const analysis = await this.analysisService.analyze(
			file,
			content,
			reflection,
			candidates,
			apiKey,
			this.settings.model,
		);
		const analysisFile = await this.repository.createAnalysis(
			file,
			analysis,
			reflection,
			this.settings.model,
		);
		new Notice('分析账本已生成');
		await this.refreshWorkspace();
		if (this.settings.openAnalysisAfterGeneration) {
			await this.app.workspace.getLeaf(false).openFile(analysisFile);
		}
		return analysisFile;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<HaidencyrilSettings>,
		);
	}

	private async handleCapture(submission: CaptureSubmission): Promise<void> {
		const file = await this.repository.createFragment(submission.content);
		new Notice('碎片已保存');
		await this.refreshWorkspace();
		if (submission.analyze) {
			window.setTimeout(() => this.openReflectionModal(file), 0);
		}
	}

	private async refreshWorkspace(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(HAIDENCYRIL_VIEW_TYPE)) {
			if (leaf.view instanceof HaidencyrilWorkspaceView) {
				await leaf.view.refresh();
			}
		}
	}
}
