import { Notice, Plugin, TFile } from 'obsidian';
import { FragmentRepository } from './data/fragment-repository';
import {
	DEFAULT_SETTINGS,
	HaidencyrilSettingTab,
	type HaidencyrilSettings,
} from './settings';
import { OllamaAnalysisService } from './services/ollama-analysis-service';
import { CaptureModal, type CaptureSubmission } from './ui/capture-modal';
import type { UserReflection } from './domain/analysis';
import { ReflectionModal } from './ui/reflection-modal';
import { AnalysisHistoryModal } from './ui/analysis-history-modal';
import {
	AiConnectionReviewModal,
	type ConnectionReviewSubmission,
} from './ui/ai-connection-review-modal';
import type { ReviewableConnection } from './data/fragment-repository';
import {
	ManualConnectionModal,
	ManualConnectionTargetModal,
} from './ui/manual-connection-modal';
import {
	HAIDENCYRIL_VIEW_TYPE,
	HaidencyrilWorkspaceView,
} from './ui/workspace-view';

export default class HaidencyrilPlugin extends Plugin {
	settings!: HaidencyrilSettings;
	repository!: FragmentRepository;
	private analysisService!: OllamaAnalysisService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.repository = new FragmentRepository(this.app, () => this.settings);
		await this.repository.removeLegacyPathMetadata();
		this.analysisService = new OllamaAnalysisService();

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
			this.settings.aiEnabled,
			(submission) => this.handleCapture(submission),
		).open();
	}

	openReflectionModal(file: TFile): void {
		if (!this.settings.aiEnabled) {
			new Notice('请先在插件设置中启用本地 AI');
			return;
		}
		new ReflectionModal(this.app, (reflection) =>
			this.analyzeFragment(file, reflection).then(() => undefined),
		).open();
	}

	openManualConnectionModal(sourceFile: TFile): void {
		new ManualConnectionTargetModal(
			this.app,
			sourceFile,
			this.settings.analysisFolder,
			(targetFile) => {
				new ManualConnectionModal(this.app, targetFile, async (submission) => {
					const created = await this.repository.addManualConnection(sourceFile, {
						targetFile,
						...submission,
					});
					new Notice(
						created ? '手动关联已建立' : '这两条笔记已经存在链接',
					);
					if (created) {
						await this.refreshWorkspace();
					}
				}).open();
			},
		).open();
	}

	openAnalysisHistoryModal(sourceFile: TFile, analysisFiles: TFile[]): void {
		new AnalysisHistoryModal(this.app, sourceFile, analysisFiles).open();
	}

	openAiConnectionReviewModal(
		sourceFile: TFile,
		analysisFile: TFile,
		suggestions: ReviewableConnection[],
	): void {
		new AiConnectionReviewModal(
			this.app,
			suggestions,
			(submission) =>
				this.handleConnectionReview(sourceFile, analysisFile, submission),
			() => this.refreshWorkspace(),
		).open();
	}

	async analyzeFragment(file: TFile, reflection: UserReflection): Promise<TFile> {
		if (!this.settings.aiEnabled) {
			throw new Error('请先在 Haidencyril 设置中启用本地 AI 分析');
		}

		new Notice('正在形成可核对的分析账本…');
		const content = await this.repository.readBody(file);
		const candidates = await this.repository.findConnectionCandidates(file, content);
		const analysis = await this.analysisService.analyze(
			file,
			content,
			reflection,
			candidates,
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
			await this.app.workspace.getLeaf(true).openFile(analysisFile);
		}
		const suggestions =
			await this.repository.getPendingConnectionSuggestions(analysisFile);
		if (suggestions.length > 0) {
			window.setTimeout(
				() =>
					this.openAiConnectionReviewModal(file, analysisFile, suggestions),
				0,
			);
		}
		return analysisFile;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as (Partial<HaidencyrilSettings> & {
			apiKeySecretName?: string;
		}) | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			saved,
		);
		if (this.settings.model.startsWith('gpt-')) {
			this.settings.model = DEFAULT_SETTINGS.model;
		}
		delete (this.settings as HaidencyrilSettings & { apiKeySecretName?: string })
			.apiKeySecretName;
		await this.saveData(this.settings);
	}

	private async handleCapture(submission: CaptureSubmission): Promise<void> {
		const file = await this.repository.createFragment(submission.content);
		new Notice('碎片已保存');
		await this.refreshWorkspace();
		if (submission.analyze) {
			window.setTimeout(() => this.openReflectionModal(file), 0);
		}
	}

	private async handleConnectionReview(
		sourceFile: TFile,
		analysisFile: TFile,
		submission: ConnectionReviewSubmission,
	): Promise<void> {
		if (submission.decision === 'accepted') {
			await this.repository.addManualConnection(sourceFile, submission);
		}
		await this.repository.recordConnectionReview(analysisFile, submission);
	}

	private async refreshWorkspace(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(HAIDENCYRIL_VIEW_TYPE)) {
			if (leaf.view instanceof HaidencyrilWorkspaceView) {
				await leaf.view.refresh();
			}
		}
	}
}
