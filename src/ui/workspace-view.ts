import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import type HaidencyrilPlugin from '../main';

export const HAIDENCYRIL_VIEW_TYPE = 'haidencyril-workspace';

export class HaidencyrilWorkspaceView extends ItemView {
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
		const root = this.containerEl.children[1];
		if (!(root instanceof HTMLElement)) {
			return;
		}
		root.empty();
		root.addClass('haidencyril-workspace');

		const header = root.createDiv({ cls: 'haidencyril-header' });
		const heading = header.createDiv();
		heading.createEl('h1', { text: 'Haidencyril' });
		heading.createEl('p', {
			text: '从碎片出发，逐渐形成理解与行动。',
			cls: 'haidencyril-muted',
		});
		const actions = header.createDiv({ cls: 'haidencyril-header-actions' });
		const refreshButton = actions.createEl('button', { text: '刷新' });
		refreshButton.addEventListener('click', () => void this.refresh());
		const captureButton = actions.createEl('button', {
			text: '记录碎片',
			cls: 'mod-cta',
		});
		captureButton.addEventListener('click', () => this.plugin.openCaptureModal());

		const files = this.plugin.repository.getInboxFiles();
		const analyzedCount = files.filter((file) => this.statusOf(file) === 'analyzed').length;
		const overview = root.createDiv({ cls: 'haidencyril-overview' });
		this.addMetric(overview, '全部碎片', files.length.toString());
		this.addMetric(overview, '待理解', (files.length - analyzedCount).toString());
		this.addMetric(overview, '已有分析', analyzedCount.toString());

		const sectionHeader = root.createDiv({ cls: 'haidencyril-section-header' });
		sectionHeader.createEl('h2', { text: '收件箱' });
		sectionHeader.createSpan({ text: '不要求预先分类' });

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

		const list = root.createDiv({ cls: 'haidencyril-fragment-list' });
		for (const file of files) {
			await this.renderFragment(list, file);
		}
	}

	private async renderFragment(container: HTMLElement, file: TFile): Promise<void> {
		const card = container.createDiv({ cls: 'haidencyril-fragment-card' });
		const top = card.createDiv({ cls: 'haidencyril-fragment-top' });
		const titleButton = top.createEl('button', {
			text: file.basename,
			cls: 'haidencyril-link-button',
		});
		titleButton.addEventListener('click', () => void this.openFile(file));
		const status = this.statusOf(file);
		top.createSpan({
			text: status === 'analyzed' ? '已有分析' : '待理解',
			cls: `haidencyril-status haidencyril-status-${status}`,
		});

		const body = await this.plugin.repository.readBody(file);
		card.createEl('p', {
			text: body.slice(0, 180) || '空白碎片',
			cls: 'haidencyril-fragment-preview',
		});
		card.createEl('time', {
			text: new Intl.DateTimeFormat('zh-CN', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			}).format(new Date(file.stat.ctime)),
		});

		const actions = card.createDiv({ cls: 'haidencyril-card-actions' });
		const openButton = actions.createEl('button', { text: '打开原文' });
		openButton.addEventListener('click', () => void this.openFile(file));
		const analyzeButton = actions.createEl('button', {
			text: status === 'analyzed' ? '重新分析' : '共同分析',
		});
		analyzeButton.addEventListener('click', () => {
			this.plugin.openReflectionModal(file);
		});
	}

	private addMetric(container: HTMLElement, label: string, value: string): void {
		const metric = container.createDiv({ cls: 'haidencyril-metric' });
		metric.createEl('strong', { text: value });
		metric.createSpan({ text: label });
	}

	private statusOf(file: TFile): string {
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
		const status = frontmatter.haidencyril_status;
		return typeof status === 'string' ? status : 'inbox';
	}

	private async openFile(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(true).openFile(file);
	}
}
