import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	SearchComponent,
	Setting,
	TFile,
} from 'obsidian';
import type { SemanticSearchResult } from '../services/semantic-search-service';

export class SemanticSearchModal extends Modal {
	private query = '';
	private resultsEl!: HTMLElement;
	private searching = false;

	constructor(
		app: App,
		private readonly onSearch: (
			query: string,
		) => Promise<SemanticSearchResult[]>,
		private readonly onOpenFile: (file: TFile) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('haidencyril-semantic-modal');
		contentEl.createEl('h2', { text: '按含义找回记忆' });
		contentEl.createEl('p', {
			text: '可以描述一件事，而不必记得原文用过哪些词。索引只由本地模型生成。',
			cls: 'haidencyril-muted',
		});
		const controls = contentEl.createDiv({
			cls: 'haidencyril-semantic-controls',
		});
		const search = new SearchComponent(controls)
			.setPlaceholder('例如：哪些记录反映了活动信息传达不清？')
			.onChange((value) => {
				this.query = value;
			});
		search.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void this.search();
			}
		});
		const button = new ButtonComponent(controls)
			.setButtonText('搜索')
			.setCta()
			.onClick(() => void this.search(button));
		this.resultsEl = contentEl.createDiv({
			cls: 'haidencyril-semantic-results',
		});
		this.resultsEl.createEl('p', {
			text: '第一次搜索会建立可删除、可重建的本地索引。',
			cls: 'haidencyril-muted',
		});
		search.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async search(button?: ButtonComponent): Promise<void> {
		if (this.searching) {
			return;
		}
		const query = this.query.trim();
		if (query.length === 0) {
			new Notice('请先描述想找的内容');
			return;
		}
		this.searching = true;
		button?.setDisabled(true);
		this.resultsEl.empty();
		this.resultsEl.createEl('p', {
			text: '正在检索本地知识库…',
			cls: 'haidencyril-muted',
		});
		try {
			const results = await this.onSearch(query);
			this.renderResults(results);
		} catch (error) {
			this.resultsEl.empty();
			const message = error instanceof Error ? error.message : '语义搜索失败';
			this.resultsEl.createEl('p', { text: message, cls: 'haidencyril-error' });
		} finally {
			this.searching = false;
			button?.setDisabled(false);
		}
	}

	private renderResults(results: SemanticSearchResult[]): void {
		this.resultsEl.empty();
		if (results.length === 0) {
			this.resultsEl.createEl('p', {
				text: '没有找到相关笔记。',
				cls: 'haidencyril-muted',
			});
			return;
		}
		for (const result of results) {
			const setting = new Setting(this.resultsEl)
				.setName(result.file.basename)
				.setDesc(result.excerpt || '这篇笔记暂时没有正文摘要。');
			setting.addButton((open) =>
				open.setButtonText('打开').onClick(() => {
					void this.onOpenFile(result.file);
				}),
			);
		}
	}
}
