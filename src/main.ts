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
import { TaskPlanningService } from './services/task-planning-service';
import { SemanticSearchService } from './services/semantic-search-service';
import { IcsCourseImportService } from './services/ics-course-import-service';
import { ScheduleRepository } from './data/schedule-repository';
import {
	TaskRepository,
	type TaskCompletionReflection,
	type VaultTask,
} from './data/task-repository';
import {
	findScheduleProposal,
	type ActionProposal,
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
import { TaskPlanningModal } from './ui/task-planning-modal';
import { TaskCompletionModal } from './ui/task-completion-modal';
import { AgendaModal, type AgendaSuggestion } from './ui/agenda-modal';
import type { CalendarBlock } from './domain/schedule';
import type { TaskListItem } from './domain/task-plan';
import {
	HAIDENCYRIL_VIEW_TYPE,
	HaidencyrilWorkspaceView,
} from './ui/workspace-view';

export default class HaidencyrilPlugin extends Plugin {
	settings!: HaidencyrilSettings;
	repository!: FragmentRepository;
	private analysisService!: OllamaAnalysisService;
	private taskPlanningService!: TaskPlanningService;
	private semanticSearchService!: SemanticSearchService;
	private courseImportService!: IcsCourseImportService;
	private scheduleRepository!: ScheduleRepository;
	private taskRepository!: TaskRepository;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.repository = new FragmentRepository(this.app, () => this.settings);
		await this.repository.removeLegacyPathMetadata();
		this.analysisService = new OllamaAnalysisService();
		this.taskPlanningService = new TaskPlanningService();
		this.semanticSearchService = new SemanticSearchService(
			this.app,
			this.repository,
		);
		this.courseImportService = new IcsCourseImportService();
		this.scheduleRepository = new ScheduleRepository(
			this.app,
			() => this.settings,
		);
		this.taskRepository = new TaskRepository(this.app, () => this.settings);

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
			id: 'schedule-current-note',
			name: '将当前笔记整理成任务并安排',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.isSchedulableFile(file)) {
					return false;
				}
				if (!checking) {
					void this.scheduleCurrentNote(file);
				}
				return true;
			},
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
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || !this.isSchedulableFile(file)) {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle('整理成任务并安排')
						.setIcon('calendar-plus')
						.onClick(() => void this.scheduleCurrentNote(file)),
				);
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

	private async scheduleCurrentNote(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const initialGoal = await this.taskFromNote(file);
		new TaskPlanningModal(
			this.app,
			initialGoal,
			await this.taskRepository.readTaskPlan(file),
			(goal, constraints) => {
				if (!this.settings.aiEnabled) {
					throw new Error('请先在 Haidencyril 设置中启用本地 AI 分析');
				}
				return this.taskPlanningService.plan(
					file,
					content,
					goal,
					constraints,
					this.settings.taskPlanningModel,
				);
			},
			(tasks) => this.saveTaskPlan(file, tasks),
			async (task, tasks) => {
				await this.saveTaskPlan(file, tasks);
				this.openScheduleModal(file, task.action);
			},
		).open();
	}

	private async saveTaskPlan(file: TFile, tasks: TaskListItem[]): Promise<void> {
		await this.taskRepository.saveTaskPlan(file, tasks);
		new Notice('任务清单已保存到当前笔记');
	}

	async getTasks(): Promise<VaultTask[]> {
		return this.taskRepository.getTasks();
	}

	openTaskCompletionModal(task: VaultTask): void {
		new TaskCompletionModal(this.app, task, (reflection) =>
			this.completeTask(task, reflection),
		).open();
	}

	private async completeTask(
		task: VaultTask,
		reflection: TaskCompletionReflection,
	): Promise<void> {
		await this.taskRepository.completeWithReflection(task, reflection);
		await this.refreshWorkspace();
		new Notice('任务已完成，执行记录已保留');
	}

	private async taskFromNote(file: TFile): Promise<string> {
		const content = await this.app.vault.cachedRead(file);
		const source = content.match(/原始碎片：\[\[([^\]]+)\]\]/u)?.[1];
		if (source) {
			return source.split('/').at(-1) ?? file.basename;
		}
		const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim();
		return heading || file.basename;
	}

	private isSchedulableFile(file: TFile | null): file is TFile {
		if (!(file instanceof TFile) || file.extension !== 'md') {
			return false;
		}
		const frontmatter: Record<string, unknown> | undefined =
			this.app.metadataCache.getFileCache(file)?.frontmatter;
		const type = frontmatter?.['haidencyril_type'];
		return ![
			'calendar_snapshot',
			'course_import',
			'schedule_draft',
			'reminder_draft',
		].includes(type as string);
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
		sourceFile: TFile,
		proposal: ActionProposal,
	): Promise<void> {
		await this.scheduleRepository.createActionDraft(sourceFile, proposal);
		await this.refreshWorkspace();
		if (proposal.destination === 'reminder') {
			const shortcutName = this.settings.reminderShortcutName.trim();
			if (!shortcutName) {
				new Notice('提醒记录已保存；未配置苹果提醒事项快捷指令');
				return;
			}
			const payload = JSON.stringify({
				title: proposal.title,
				due: this.formatShortcutDate(proposal.due),
			});
			this.runShortcut(shortcutName, payload);
			new Notice('提醒记录已保存，并已交给苹果提醒事项快捷指令');
			return;
		}
		const shortcutName = this.settings.calendarShortcutName.trim();
		if (!shortcutName) {
			new Notice('日程草案已保存；未配置苹果日历快捷指令');
			return;
		}
		const payload = JSON.stringify({
			title: proposal.title,
			start: this.formatShortcutDate(proposal.start),
			end: this.formatShortcutDate(proposal.end),
			notes: `来自 Haidencyril：${sourceFile.basename}`,
		});
		this.runShortcut(shortcutName, payload);
		new Notice('日程草案已保存，并已交给苹果快捷指令');
	}

	private runShortcut(name: string, payload: string): void {
		const url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(payload)}`;
		window.open(url);
	}

	private formatShortcutDate(value: Date): string {
		const pad = (part: number): string => part.toString().padStart(2, '0');
		return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
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
