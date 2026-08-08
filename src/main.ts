import { Notice, Plugin, TFile } from 'obsidian';
import {
	FragmentRepository,
	type ProjectDraft,
} from './data/fragment-repository';
import {
	DEFAULT_SETTINGS,
	HaidencyrilSettingTab,
	type HaidencyrilSettings,
} from './settings';
import { OllamaAnalysisService } from './services/ollama-analysis-service';
import { SemanticSearchService } from './services/semantic-search-service';
import { IcsCourseImportService } from './services/ics-course-import-service';
import { ScheduleRepository } from './data/schedule-repository';
import {
	findScheduleProposal,
	type ScheduleProposal,
	type ScheduleRequest,
} from './domain/schedule';
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
import { ProjectPromotionModal } from './ui/project-promotion-modal';
import { ProjectReviewModal } from './ui/project-review-modal';
import { SemanticSearchModal } from './ui/semantic-search-modal';
import { CourseImportModal } from './ui/course-import-modal';
import { ScheduleModal } from './ui/schedule-modal';
import { AgendaModal, type AgendaSuggestion } from './ui/agenda-modal';
import type { CalendarBlock } from './domain/schedule';
import {
	HAIDENCYRIL_VIEW_TYPE,
	HaidencyrilWorkspaceView,
} from './ui/workspace-view';

export default class HaidencyrilPlugin extends Plugin {
	settings!: HaidencyrilSettings;
	repository!: FragmentRepository;
	private analysisService!: OllamaAnalysisService;
	private semanticSearchService!: SemanticSearchService;
	private courseImportService!: IcsCourseImportService;
	private scheduleRepository!: ScheduleRepository;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.repository = new FragmentRepository(this.app, () => this.settings);
		await this.repository.removeLegacyPathMetadata();
		this.analysisService = new OllamaAnalysisService();
		this.semanticSearchService = new SemanticSearchService(
			this.app,
			this.repository,
		);
		this.courseImportService = new IcsCourseImportService();
		this.scheduleRepository = new ScheduleRepository(
			this.app,
			() => this.settings,
		);

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
		this.addCommand({
			id: 'semantic-search',
			name: '按含义搜索知识库',
			callback: () => this.openSemanticSearchModal(),
		});
		this.addCommand({
			id: 'import-course-calendar',
			name: '导入 .ics 固定日程',
			callback: () => this.openCourseImportModal(),
		});
		this.addCommand({
			id: 'open-agenda-suggestions',
			name: '查看日程建议',
			callback: () => void this.openAgendaModal(),
		});
		this.addCommand({
			id: 'copy-shortcut-capture-url',
			name: '复制苹果快捷指令捕捉地址模板',
			callback: () => void this.copyShortcutCaptureUrl(),
		});
		this.addCommand({
			id: 'reopen-completed-project',
			name: '重新打开当前已完成项目',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const isCompletedProject =
					file instanceof TFile &&
					this.app.metadataCache.getFileCache(file)?.frontmatter?.[
						'haidencyril_type'
					] === 'project' &&
					this.app.metadataCache.getFileCache(file)?.frontmatter?.[
						'haidencyril_status'
					] === 'completed';
				if (isCompletedProject && !checking) {
					void this.repository.reopenProject(file).then(() =>
						this.refreshWorkspace(),
					);
				}
				return isCompletedProject;
			},
		});
		this.registerObsidianProtocolHandler(
			'haidencyril-capture',
			(params) => void this.handleProtocolCapture(params),
		);
		this.registerObsidianProtocolHandler(
			'haidencyril-calendar-sync',
			(params) => void this.handleCalendarSync(params),
		);
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

	openProjectPromotionModal(sourceFile: TFile): void {
		new ProjectPromotionModal(
			this.app,
			sourceFile,
			this.repository.getInboxFiles(),
			(draft) => this.createProject(draft).then(() => undefined),
		).open();
	}

	openProjectReviewModal(projectFile: TFile): void {
		new ProjectReviewModal(
			this.app,
			projectFile.basename,
			async (review) => {
				await this.repository.completeProject(projectFile, review);
				new Notice('项目已完成，复盘已经保留');
				await this.refreshWorkspace();
			},
		).open();
	}

	openSemanticSearchModal(): void {
		new SemanticSearchModal(
			this.app,
			(query) =>
				this.semanticSearchService.search(
					query,
					this.settings.embeddingModel,
				),
			(file) => this.app.workspace.getLeaf(true).openFile(file),
		).open();
	}

	openCourseImportModal(): void {
		new CourseImportModal(this.app, async (content, sourceName) => {
			const blocks = this.courseImportService.parse(content);
			const file = await this.scheduleRepository.saveImportedCourses(
				blocks,
				sourceName,
			);
			await this.app.workspace.getLeaf(true).openFile(file);
			return blocks.length;
		}).open();
	}

	async openAgendaModal(): Promise<void> {
		const [blocks, projects] = await Promise.all([
			this.scheduleRepository.getAgendaBlocks(),
			this.repository.getProjects(),
		]);
		const deadline = new Date();
		deadline.setDate(deadline.getDate() + 7);
		deadline.setHours(22, 0, 0, 0);
		const suggestions: AgendaSuggestion[] = projects
			.filter((project) => project.status === 'active')
			.map((project) => ({
				projectFile: project.file,
				projectTitle: project.file.basename,
				task: project.nextAction,
				proposal: findScheduleProposal(
					{
						title: project.nextAction,
						durationMinutes: 60,
						deadline,
						priority: 'normal',
					},
					blocks,
				),
			}));
		new AgendaModal(
			this.app,
			blocks,
			suggestions,
			() => this.runCalendarSyncShortcut(),
			() => this.openCourseImportModal(),
			(projectFile, task) => this.openScheduleModal(projectFile, task),
		).open();
	}

	async getAgendaBlocks(): Promise<CalendarBlock[]> {
		return this.scheduleRepository.getAgendaBlocks();
	}

	openScheduleModal(projectFile: TFile, nextAction: string): void {
		new ScheduleModal(
			this.app,
			nextAction,
			(request) => this.generateScheduleProposal(request),
			(proposal) => this.confirmSchedule(projectFile, proposal),
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

	private async createProject(draft: ProjectDraft): Promise<TFile> {
		const projectFile = await this.repository.createProject(draft);
		new Notice('项目已创建，下一步行动已经写入');
		await this.refreshWorkspace();
		await this.app.workspace.getLeaf(true).openFile(projectFile);
		return projectFile;
	}

	private async generateScheduleProposal(
		request: ScheduleRequest,
	): Promise<ScheduleProposal | null> {
		return findScheduleProposal(
			request,
			await this.scheduleRepository.getBusyBlocks(),
		);
	}

	private async confirmSchedule(
		projectFile: TFile,
		proposal: ScheduleProposal,
	): Promise<void> {
		await this.scheduleRepository.createScheduleDraft(projectFile, proposal);
		await this.refreshWorkspace();
		const shortcutName = this.settings.calendarShortcutName.trim();
		if (!shortcutName) {
			new Notice('日程草案已保存；未配置苹果日历快捷指令');
			return;
		}
		const payload = JSON.stringify({
			title: proposal.title,
			start: proposal.start.toISOString(),
			end: proposal.end.toISOString(),
			notes: `来自 Haidencyril 项目：${projectFile.basename}`,
		});
		const url = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(payload)}`;
		window.open(url);
		new Notice('日程草案已保存，并已交给苹果快捷指令');
	}

	private async handleProtocolCapture(
		params: Record<string, string>,
	): Promise<void> {
		const content = params['content']?.trim() ?? '';
		if (!content) {
			new Notice('快捷指令没有传入可记录的内容');
			return;
		}
		try {
			const file = await this.repository.createFragment(content);
			new Notice('快捷指令内容已保存');
			await this.refreshWorkspace();
			if (params['analyze'] === 'true' && this.settings.aiEnabled) {
				window.setTimeout(() => this.openReflectionModal(file), 0);
			}
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '快捷捕捉失败');
		}
	}

	private async handleCalendarSync(
		params: Record<string, string>,
	): Promise<void> {
		try {
			const now = new Date();
			const horizon = new Date(now);
			horizon.setDate(horizon.getDate() + 8);
			const blocks = this.parseCalendarPayload(params['events'] ?? '')
				.filter((block) => new Date(block.end) >= now)
				.filter((block) => new Date(block.start) <= horizon);
			await this.scheduleRepository.saveCalendarSnapshot(
				blocks,
				'苹果快捷指令',
			);
			await this.refreshWorkspace();
			new Notice(`已同步 ${blocks.length} 项苹果日历安排`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '同步苹果日历失败');
		}
	}

	private runCalendarSyncShortcut(): void {
		const shortcutName = this.settings.calendarSyncShortcutName.trim();
		if (!shortcutName) {
			new Notice('请先在设置中填写日历同步快捷指令名称');
			return;
		}
		window.open(
			`shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`,
		);
		new Notice('正在通过快捷指令读取未来八天日程');
	}

	private parseCalendarPayload(payload: string): CalendarBlock[] {
		const value = payload.trim();
		if (!value) {
			return [];
		}
		let parsed: unknown;
		if (value.includes('HCRECORD')) {
			parsed = value
				.split('HCRECORD')
				.map((record) => record.trim())
				.filter(Boolean)
				.map((record) => {
					const [title, end, start] = record
						.split('HCSEP')
						.map((field) => field.trim());
					return { title, start, end, location: '' };
				});
		} else {
			try {
				parsed = JSON.parse(value);
			} catch {
			parsed = value.split('\n').filter(Boolean).map((line) => {
				const [title, start, end, location = ''] = line.split('\t');
				return { title, start, end, location };
			});
			}
		}
		if (!Array.isArray(parsed)) {
			throw new Error('快捷指令返回的日程格式不正确');
		}
		return parsed.map((entry, index) => {
			if (typeof entry !== 'object' || entry === null) {
				throw new Error(`第 ${index + 1} 项日程格式不正确`);
			}
			const candidate = entry as Record<string, unknown>;
			const title = typeof candidate['title'] === 'string' ? candidate['title'].trim() : '';
			const start = typeof candidate['start'] === 'string' ? candidate['start'] : '';
			const end = typeof candidate['end'] === 'string' ? candidate['end'] : '';
			if (
				!title ||
				Number.isNaN(new Date(start).getTime()) ||
				Number.isNaN(new Date(end).getTime())
			) {
				throw new Error(`第 ${index + 1} 项日程缺少有效的标题或时间`);
			}
			return {
				title,
				start: new Date(start).toISOString(),
				end: new Date(end).toISOString(),
				location:
					typeof candidate['location'] === 'string'
						? candidate['location'].trim()
						: '',
				kind: 'fixed',
			};
		});
	}

	private async copyShortcutCaptureUrl(): Promise<void> {
		const vault = encodeURIComponent(this.app.vault.getName());
		const template = `obsidian://haidencyril-capture?vault=${vault}&content=[URL 编码后的内容]`;
		await navigator.clipboard.writeText(template);
		new Notice('快捷指令捕捉地址模板已复制');
	}

	private async refreshWorkspace(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(HAIDENCYRIL_VIEW_TYPE)) {
			if (leaf.view instanceof HaidencyrilWorkspaceView) {
				await leaf.view.refresh();
			}
		}
	}
}
