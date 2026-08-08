import {
	DropdownComponent,
	ItemView,
	SearchComponent,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type HaidencyrilPlugin from '../main';
import type { ReviewableConnection } from '../data/fragment-repository';

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
		const captureButton = actions.createEl('button', {
			text: '＋ 记录碎片',
			cls: 'mod-cta',
		});
		captureButton.addEventListener('click', () => this.plugin.openCaptureModal());

		const files = this.plugin.repository.getInboxFiles();
		const analysisHistory = await this.plugin.repository.getAnalysisHistory();
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
		const overview = root.createDiv({ cls: 'haidencyril-overview' });
		this.addMetric(overview, '全部碎片', files.length.toString());
		this.addMetric(overview, '待理解', (files.length - analyzedCount).toString());
		this.addMetric(overview, '已有分析', analyzedCount.toString());

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
