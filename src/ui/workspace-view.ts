import {
	DropdownComponent,
	ItemView,
	SearchComponent,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type HaidencyrilPlugin from '../main';
import type {
	ProjectSummary,
	ReviewableConnection,
} from '../data/fragment-repository';
import type { CalendarBlock } from '../domain/schedule';
import type { VaultTask } from '../data/task-repository';
import type { ThemeSummary } from '../data/theme-repository';

export const HAIDENCYRIL_VIEW_TYPE = 'haidencyril-workspace';

type FragmentStatus = 'inbox' | 'analyzed';
type FragmentStatusFilter = 'all' | FragmentStatus;

interface FragmentEntry {
	file: TFile;
	body: string;
	status: FragmentStatus;
	analysisFiles: TFile[];
	pendingReview: PendingConnectionReview | null;
	pendingSuggestionCount: number;
}

interface PendingConnectionReview {
	analysisFile: TFile;
	suggestions: ReviewableConnection[];
}

export class HaidencyrilWorkspaceView extends ItemView {
	private searchQuery = '';
	private statusFilter: FragmentStatusFilter = 'all';
	private refreshVersion = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: HaidencyrilPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HAIDENCYRIL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Haidencyril';
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const refreshVersion = ++this.refreshVersion;
		const root = this.containerEl.children[1];
		if (!(root instanceof HTMLElement)) {
			return;
		}
		root.empty();
		root.addClass('haidencyril-workspace');

		const header = root.createDiv({ cls: 'haidencyril-header' });
		const heading = header.createDiv();
		heading.createSpan({
			text: '个人知识工作台',
			cls: 'haidencyril-eyebrow',
		});
		heading.createEl('h1', { text: 'Haidencyril' });
		heading.createEl('p', {
			text: '从碎片出发，逐渐形成理解与行动。',
			cls: 'haidencyril-muted',
		});
		const actions = header.createDiv({ cls: 'haidencyril-header-actions' });
		const refreshButton = actions.createEl('button', {
			text: '刷新',
			cls: 'haidencyril-secondary-button',
		});
		refreshButton.addEventListener('click', () => void this.refresh());
		const semanticButton = actions.createEl('button', {
			text: '语义搜索',
			cls: 'haidencyril-secondary-button',
		});
		semanticButton.addEventListener('click', () =>
			this.plugin.openSemanticSearchModal(),
		);
		const agendaButton = actions.createEl('button', {
			text: '日程建议',
			cls: 'haidencyril-secondary-button',
		});
		agendaButton.addEventListener('click', () =>
			void this.plugin.openAgendaModal(),
		);
		const captureButton = actions.createEl('button', {
			text: '＋ 记录碎片',
			cls: 'mod-cta',
		});
		captureButton.addEventListener('click', () => this.plugin.openCaptureModal());

		const files = this.plugin.repository.getInboxFiles();
		const [analysisHistory, projects, agendaBlocks, tasks, themes] = await Promise.all([
			this.plugin.repository.getAnalysisHistory(),
			this.plugin.repository.getProjects(),
			this.plugin.getAgendaBlocks(),
			this.plugin.getTasks(),
			this.plugin.getThemes(),
		]);
		const entries = await Promise.all(
			files.map(async (file): Promise<FragmentEntry> => {
				const analysisFiles = analysisHistory.get(file.path) ?? [];
				const reviews = await Promise.all(
					analysisFiles.map(async (analysisFile) => ({
						analysisFile,
						suggestions:
							await this.plugin.repository.getPendingConnectionSuggestions(
								analysisFile,
							),
					})),
				);
				const pendingReviews = reviews.filter(
					(review) => review.suggestions.length > 0,
				);
				return {
					file,
					body: await this.plugin.repository.readBody(file),
					status:
						analysisFiles.length > 0 ? 'analyzed' : this.statusOf(file),
					analysisFiles,
					pendingReview: pendingReviews[0] ?? null,
					pendingSuggestionCount: pendingReviews.reduce(
						(total, review) => total + review.suggestions.length,
						0,
					),
				};
			}),
		);
		if (refreshVersion !== this.refreshVersion) {
			return;
		}
		const analyzedCount = entries.filter(
			(entry) => entry.status === 'analyzed',
		).length;
		const activeProjects = projects.filter(
			(project) => project.status === 'active',
		);
		const completedProjects = projects.filter(
			(project) => project.status === 'completed',
		);
		const overview = root.createDiv({ cls: 'haidencyril-overview' });
		this.addMetric(overview, '全部碎片', files.length.toString());
		this.addMetric(overview, '待理解', (files.length - analyzedCount).toString());
		this.addMetric(overview, '已有分析', analyzedCount.toString());
		this.addMetric(
			overview,
			'推进中 / 已完成',
			`${activeProjects.length} / ${completedProjects.length}`,
		);
		this.renderToday(root, agendaBlocks);
		this.renderTasks(root, tasks);

		if (activeProjects.length > 0) {
			this.renderProjects(root, activeProjects);
		}
		if (completedProjects.length > 0) {
			this.renderCompletedProjects(root, completedProjects.slice(0, 4));
		}
		if (themes.length > 0) {
			this.renderThemes(root, themes);
		}

		const sectionHeader = root.createDiv({ cls: 'haidencyril-section-header' });
		sectionHeader.createEl('h2', { text: '收件箱' });
		const resultCount = sectionHeader.createSpan();

		if (files.length === 0) {
			const empty = root.createDiv({ cls: 'haidencyril-empty' });
			empty.createEl('h3', { text: '先留下第一个碎片' });
			empty.createEl('p', {
				text: '它可以只是半句话。关系和结构会在记录积累后逐渐出现。',
			});
			const button = empty.createEl('button', { text: '开始记录', cls: 'mod-cta' });
			button.addEventListener('click', () => this.plugin.openCaptureModal());
			return;
		}

		const controls = root.createDiv({ cls: 'haidencyril-search-controls' });
		const searchHost = controls.createDiv({ cls: 'haidencyril-search-field' });
		const search = new SearchComponent(searchHost)
			.setPlaceholder('搜索碎片内容…')
			.setValue(this.searchQuery);
		const filterHost = controls.createDiv({ cls: 'haidencyril-status-filter' });
		filterHost.createSpan({ text: '状态' });
		const filter = new DropdownComponent(filterHost)
			.addOption('all', '全部')
			.addOption('inbox', '待理解')
			.addOption('analyzed', '已有分析')
			.setValue(this.statusFilter);
		const list = root.createDiv({ cls: 'haidencyril-fragment-list' });
		const renderResults = (): void => {
			const filteredEntries = this.filterEntries(entries);
			resultCount.setText(`显示 ${filteredEntries.length} / ${entries.length} 条`);
			list.empty();
			if (filteredEntries.length === 0) {
				const empty = list.createDiv({
					cls: 'haidencyril-empty haidencyril-search-empty',
				});
				empty.createEl('h3', { text: '没有找到匹配的碎片' });
				empty.createEl('p', { text: '可以换一个关键词，或清除状态筛选。' });
				const resetButton = empty.createEl('button', {
					text: '清除筛选',
				});
				resetButton.addEventListener('click', () => {
					this.searchQuery = '';
					this.statusFilter = 'all';
					search.setValue('');
					filter.setValue('all');
					renderResults();
				});
				return;
			}

			for (const entry of filteredEntries) {
				this.renderFragment(list, entry);
			}
		};
		search.onChange((value) => {
			this.searchQuery = value;
			renderResults();
		});
		filter.onChange((value) => {
			this.statusFilter = this.parseStatusFilter(value);
			renderResults();
		});
		renderResults();
	}

	private renderTasks(container: HTMLElement, tasks: VaultTask[]): void {
		const openTasks = tasks.filter((task) => !task.completed);
		const header = container.createDiv({
			cls: 'haidencyril-section-header haidencyril-task-board-header',
		});
		header.createEl('h2', { text: '待办任务' });
		header.createSpan({ text: `${openTasks.length} 项未完成` });
		const list = container.createDiv({ cls: 'haidencyril-task-board-list' });
		if (openTasks.length === 0) {
			list.createEl('p', {
				text: '还没有可执行任务。可以从任意笔记整理任务清单。',
				cls: 'haidencyril-today-empty',
			});
			return;
		}
		for (const task of openTasks) {
			const card = list.createDiv({ cls: 'haidencyril-task-board-card' });
			const checkbox = card.createEl('input');
			checkbox.type = 'checkbox';
			checkbox.ariaLabel = `完成：${task.action}`;
			checkbox.addEventListener('change', () => {
				checkbox.checked = false;
				this.plugin.openTaskCompletionModal(task);
			});
			const content = card.createDiv({ cls: 'haidencyril-task-board-content' });
			content.createEl('strong', { text: task.action });
			if (task.doneWhen) {
				content.createEl('p', { text: `完成标准：${task.doneWhen}` });
			}
			content.createSpan({
				text: this.taskSourceTitle(task.file),
				cls: 'haidencyril-task-board-source',
			});
			const actions = card.createDiv({ cls: 'haidencyril-task-board-actions' });
			const schedule = actions.createEl('button', {
				text: '安排',
				cls: 'haidencyril-card-button',
			});
			schedule.addEventListener('click', () =>
				this.plugin.openScheduleModal(task.file, task.action),
			);
			const open = actions.createEl('button', {
				text: '打开',
				cls: 'haidencyril-card-button',
			});
			open.addEventListener('click', () => void this.openFile(task.file));
		}
	}

	private taskSourceTitle(file: TFile): string {
		return file.basename.replace(/ - \d{4}-\d{2}-\d{2}T.*$/u, '');
	}

	private renderToday(container: HTMLElement, blocks: CalendarBlock[]): void {
		const today = new Date();
		const todayBlocks = blocks.filter(
			(block) => new Date(block.start).toDateString() === today.toDateString(),
		);
		const header = container.createDiv({
			cls: 'haidencyril-section-header haidencyril-today-header',
		});
		header.createEl('h2', { text: '今天' });
		const open = header.createEl('button', {
			text: '查看日程建议',
			cls: 'haidencyril-link-button',
		});
		open.addEventListener('click', () => void this.plugin.openAgendaModal());
		const list = container.createDiv({ cls: 'haidencyril-today-list' });
		if (todayBlocks.length === 0) {
			list.createEl('p', {
				text: '今天没有已同步的安排。你可以保留空白，也可以从项目下一步生成建议。',
				cls: 'haidencyril-today-empty',
			});
			return;
		}
		const formatter = new Intl.DateTimeFormat('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		for (const block of todayBlocks) {
			const item = list.createDiv({ cls: 'haidencyril-today-item' });
			item.createEl('time', {
				text: `${formatter.format(new Date(block.start))}–${formatter.format(new Date(block.end))}`,
			});
			const content = item.createDiv();
			content.createEl('strong', { text: block.title });
			if (block.location) {
				content.createSpan({ text: block.location });
			}
		}
	}

	private renderFragment(container: HTMLElement, entry: FragmentEntry): void {
		const {
			analysisFiles,
			body,
			file,
			pendingReview,
			pendingSuggestionCount,
			status,
		} = entry;
		const card = container.createDiv({ cls: 'haidencyril-fragment-card' });
		const top = card.createDiv({ cls: 'haidencyril-fragment-top' });
		const titleButton = top.createEl('button', {
			text: body.slice(0, 260) || file.basename,
			cls: 'haidencyril-link-button',
		});
		titleButton.addEventListener('click', () => void this.openFile(file));
		top.createSpan({
			text: status === 'analyzed' ? '已有分析' : '待理解',
			cls: `haidencyril-status haidencyril-status-${status}`,
		});

		const footer = card.createDiv({ cls: 'haidencyril-card-footer' });
		footer.createEl('time', {
			text: new Intl.DateTimeFormat('zh-CN', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			}).format(new Date(file.stat.ctime)),
		});

		const actions = footer.createDiv({ cls: 'haidencyril-card-actions' });
		const openButton = actions.createEl('button', {
			text: '打开原文',
			cls: 'haidencyril-card-button',
		});
		openButton.addEventListener('click', () => void this.openFile(file));
		const connectButton = actions.createEl('button', {
			text: '手动关联',
			cls: 'haidencyril-card-button',
		});
		connectButton.addEventListener('click', () => {
			this.plugin.openManualConnectionModal(file);
		});
		const promoteButton = actions.createEl('button', {
			text: '形成项目',
			cls: 'haidencyril-card-button',
		});
		promoteButton.addEventListener('click', () => {
			this.plugin.openProjectPromotionModal(file);
		});
		if (analysisFiles.length > 0) {
			const historyButton = actions.createEl('button', {
				text: `分析历史 ${analysisFiles.length}`,
				cls: 'haidencyril-card-button',
			});
			historyButton.addEventListener('click', () => {
				this.plugin.openAnalysisHistoryModal(file, analysisFiles);
			});
		}
		if (pendingReview) {
			const reviewButton = actions.createEl('button', {
				text: `审核建议 ${pendingSuggestionCount}`,
				cls: 'haidencyril-card-button haidencyril-card-button-primary',
			});
			reviewButton.addEventListener('click', () => {
				this.plugin.openAiConnectionReviewModal(
					file,
					pendingReview.analysisFile,
					pendingReview.suggestions,
				);
			});
		}
		const analyzeButton = actions.createEl('button', {
			text: status === 'analyzed' ? '重新分析' : '共同分析',
			cls: 'haidencyril-card-button haidencyril-card-button-primary',
		});
		analyzeButton.addEventListener('click', () => {
			this.plugin.openReflectionModal(file);
		});
	}

	private renderProjects(
		container: HTMLElement,
		projects: ProjectSummary[],
	): void {
		const header = container.createDiv({
			cls: 'haidencyril-section-header haidencyril-projects-header',
		});
		header.createEl('h2', { text: '正在推进' });
		header.createSpan({ text: `${projects.length} 个项目` });
		const list = container.createDiv({ cls: 'haidencyril-project-list' });
		for (const project of projects) {
			const card = list.createDiv({ cls: 'haidencyril-project-card' });
			const top = card.createDiv({ cls: 'haidencyril-project-card-top' });
			const content = top.createDiv();
			const titleButton = content.createEl('button', {
				text: project.file.basename,
				cls: 'haidencyril-project-title',
			});
			titleButton.addEventListener('click', () => void this.openFile(project.file));
			content.createEl('p', { text: project.goal });
			top.createSpan({
				text: `${project.sourceCount} 条碎片`,
				cls: 'haidencyril-status haidencyril-status-analyzed',
			});
			const next = card.createDiv({ cls: 'haidencyril-project-next' });
			next.createSpan({ text: '下一步' });
			next.createEl('strong', { text: project.nextAction });
			const actions = card.createDiv({ cls: 'haidencyril-project-actions' });
			const scheduleButton = actions.createEl('button', {
				text: '安排下一步',
				cls: 'haidencyril-card-button',
			});
			scheduleButton.addEventListener('click', () =>
				this.plugin.openScheduleModal(project.file, project.nextAction),
			);
			const completeButton = actions.createEl('button', {
				text: '完成并复盘',
				cls: 'haidencyril-card-button haidencyril-card-button-primary',
			});
			completeButton.addEventListener('click', () =>
				this.plugin.openProjectReviewModal(project.file),
			);
		}
	}

	private renderCompletedProjects(
		container: HTMLElement,
		projects: ProjectSummary[],
	): void {
		const header = container.createDiv({
			cls: 'haidencyril-section-header haidencyril-completed-header',
		});
		header.createEl('h2', { text: '最近完成' });
		header.createSpan({ text: '结果可以继续沉淀为新碎片' });
		const list = container.createDiv({ cls: 'haidencyril-completed-list' });
		for (const project of projects) {
			const card = list.createDiv({ cls: 'haidencyril-completed-card' });
			const title = card.createEl('button', {
				text: project.file.basename,
				cls: 'haidencyril-project-title',
			});
			title.addEventListener('click', () => void this.openFile(project.file));
			card.createEl('p', {
				text: project.outcome || '已完成，打开项目查看复盘。',
			});
			const actions = card.createDiv({ cls: 'haidencyril-completed-actions' });
			const evolve = actions.createEl('button', {
				text: '沉淀长期主题',
				cls: 'haidencyril-card-button haidencyril-card-button-primary',
			});
			evolve.addEventListener('click', () =>
				void this.plugin.openThemeEvolutionModal(project.file),
			);
		}
	}

	private renderThemes(container: HTMLElement, themes: ThemeSummary[]): void {
		const header = container.createDiv({
			cls: 'haidencyril-section-header haidencyril-themes-header',
		});
		header.createEl('h2', { text: '长期主题' });
		header.createSpan({
			text: `${themes.length} 个主题 · ${themes.reduce((total, theme) => total + theme.occurrenceCount, 0)} 次观察`,
		});
		const list = container.createDiv({ cls: 'haidencyril-theme-list' });
		for (const theme of themes) {
			const card = list.createDiv({ cls: 'haidencyril-theme-card' });
			const top = card.createDiv({ cls: 'haidencyril-theme-card-top' });
			const title = top.createEl('button', {
				text: theme.title,
				cls: 'haidencyril-project-title',
			});
			title.addEventListener('click', () => void this.openFile(theme.file));
			top.createSpan({
				text: `${theme.occurrenceCount} 次`,
				cls: 'haidencyril-status haidencyril-status-analyzed',
			});
			card.createEl('p', { text: theme.statement });
			card.createEl('small', { text: `最近观察：${theme.latestObservation}` });
		}
	}

	private filterEntries(entries: FragmentEntry[]): FragmentEntry[] {
		const terms = this.searchQuery
			.trim()
			.toLocaleLowerCase()
			.split(/\s+/u)
			.filter(Boolean);
		return entries.filter((entry) => {
			if (this.statusFilter !== 'all' && entry.status !== this.statusFilter) {
				return false;
			}
			if (terms.length === 0) {
				return true;
			}
			const searchableText = `${entry.file.basename}\n${entry.body}`.toLocaleLowerCase();
			return terms.every((term) => searchableText.includes(term));
		});
	}

	private parseStatusFilter(value: string): FragmentStatusFilter {
		return value === 'inbox' || value === 'analyzed' ? value : 'all';
	}

	private addMetric(container: HTMLElement, label: string, value: string): void {
		const metric = container.createDiv({ cls: 'haidencyril-metric' });
		metric.createEl('strong', { text: value });
		metric.createSpan({ text: label });
	}

	private statusOf(file: TFile): FragmentStatus {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(
			file,
		)?.frontmatter;
		if (
			typeof frontmatter !== 'object' ||
			frontmatter === null ||
			!('haidencyril_status' in frontmatter)
		) {
			return 'inbox';
		}
		return frontmatter.haidencyril_status === 'analyzed' ? 'analyzed' : 'inbox';
	}

	private async openFile(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(true).openFile(file);
	}
}
