import { App, Modal, TFile } from 'obsidian';

export class AnalysisHistoryModal extends Modal {
	constructor(
		app: App,
		private readonly sourceFile: TFile,
		private readonly analysisFiles: TFile[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-history-modal');
		contentEl.createEl('h2', { text: '分析历史' });
		contentEl.createEl('p', {
			text: this.sourceFile.basename,
			cls: 'haidencyril-history-source',
		});

		const list = contentEl.createDiv({ cls: 'haidencyril-history-list' });
		this.analysisFiles.forEach((file, index) => {
			const item = list.createDiv({ cls: 'haidencyril-history-item' });
			const details = item.createDiv();
			details.createEl('strong', {
				text:
					index === 0
						? '最新分析'
						: `第 ${this.analysisFiles.length - index} 次分析`,
			});
			details.createEl('time', { text: this.createdLabel(file) });
			const model = this.modelOf(file);
			if (model) {
				details.createSpan({ text: `模型：${model}` });
			}
			const openButton = item.createEl('button', {
				text: index === 0 ? '打开最新' : '打开',
				cls: index === 0 ? 'mod-cta' : undefined,
			});
			openButton.addEventListener('click', () => {
				void this.openAnalysis(file);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async openAnalysis(file: TFile): Promise<void> {
		this.close();
		await this.app.workspace.getLeaf(true).openFile(file);
	}

	private createdLabel(file: TFile): string {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(
			file,
		)?.frontmatter;
		let createdAt = file.stat.ctime;
		if (
			typeof frontmatter === 'object' &&
			frontmatter !== null &&
			'haidencyril_created' in frontmatter &&
			(typeof frontmatter.haidencyril_created === 'string' ||
				typeof frontmatter.haidencyril_created === 'number')
		) {
			const parsed = new Date(frontmatter.haidencyril_created).getTime();
			if (!Number.isNaN(parsed)) {
				createdAt = parsed;
			}
		}
		return new Intl.DateTimeFormat('zh-CN', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(createdAt));
	}

	private modelOf(file: TFile): string | null {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(
			file,
		)?.frontmatter;
		if (
			typeof frontmatter !== 'object' ||
			frontmatter === null ||
			!('haidencyril_model' in frontmatter)
		) {
			return null;
		}
		return typeof frontmatter.haidencyril_model === 'string'
			? frontmatter.haidencyril_model
			: null;
	}
}
