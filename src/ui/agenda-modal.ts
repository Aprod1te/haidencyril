import { App, Modal, Setting, TFile } from 'obsidian';
import type { CalendarBlock, ScheduleProposal } from '../domain/schedule';

export interface AgendaSuggestion {
	projectFile: TFile;
	projectTitle: string;
	task: string;
	proposal: ScheduleProposal | null;
}

export class AgendaModal extends Modal {
	constructor(
		app: App,
		private readonly blocks: CalendarBlock[],
		private readonly suggestions: AgendaSuggestion[],
		private readonly onSync: () => void,
		private readonly onImport: () => void,
		private readonly onSchedule: (projectFile: TFile, task: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('haidencyril-agenda-shell');
		this.contentEl.addClass('haidencyril-agenda-modal');
		const header = this.contentEl.createDiv({ cls: 'haidencyril-agenda-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: '日程建议' });
		heading.createEl('p', {
			text: '先看已有安排，再决定项目行动放在哪里。日期和时间仍由你最终确认。',
			cls: 'haidencyril-muted',
		});
		const actions = header.createDiv({ cls: 'haidencyril-agenda-actions' });
		const sync = actions.createEl('button', {
			text: '同步苹果日历',
			cls: 'mod-cta',
		});
		sync.addEventListener('click', this.onSync);
		const importButton = actions.createEl('button', { text: '导入 .ics' });
		importButton.addEventListener('click', () => {
			this.close();
			this.onImport();
		});

		this.renderAgenda();
		this.renderSuggestions();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderAgenda(): void {
		const section = this.contentEl.createDiv({ cls: 'haidencyril-agenda-section' });
		const title = section.createDiv({ cls: 'haidencyril-agenda-section-title' });
		title.createEl('h3', { text: '未来八天' });
		title.createSpan({ text: `${this.blocks.length} 项已有安排` });
		if (this.blocks.length === 0) {
			section.createEl('p', {
				text: '还没有可用日程。运行同步快捷指令，或导入 .ics 文件。',
				cls: 'haidencyril-agenda-empty',
			});
			return;
		}

		const groups = new Map<string, CalendarBlock[]>();
		for (const block of this.blocks) {
			const key = new Date(block.start).toDateString();
			const group = groups.get(key) ?? [];
			group.push(block);
			groups.set(key, group);
		}
		const list = section.createDiv({ cls: 'haidencyril-agenda-days' });
		for (const blocks of groups.values()) {
			const day = list.createDiv({ cls: 'haidencyril-agenda-day' });
			day.createEl('h4', { text: this.formatDay(new Date(blocks[0]!.start)) });
			for (const block of blocks) {
				const row = day.createDiv({ cls: 'haidencyril-agenda-row' });
				row.createEl('time', { text: this.formatTimeRange(block) });
				const content = row.createDiv();
				content.createEl('strong', { text: block.title });
				if (block.location) {
					content.createSpan({ text: block.location });
				}
				row.createSpan({
					text: this.kindLabel(block.kind),
					cls: 'haidencyril-agenda-kind',
				});
			}
		}
	}

	private renderSuggestions(): void {
		const section = this.contentEl.createDiv({ cls: 'haidencyril-agenda-section' });
		const title = section.createDiv({ cls: 'haidencyril-agenda-section-title' });
		title.createEl('h3', { text: '项目行动建议' });
		title.createSpan({ text: '建议不是承诺，写入前仍需确认' });
		if (this.suggestions.length === 0) {
			section.createEl('p', {
				text: '当前没有正在推进的项目。先从一组相关碎片形成项目。',
				cls: 'haidencyril-agenda-empty',
			});
			return;
		}
		const list = section.createDiv({ cls: 'haidencyril-agenda-suggestions' });
		for (const suggestion of this.suggestions) {
			const card = list.createDiv({ cls: 'haidencyril-agenda-suggestion' });
			const content = card.createDiv();
			content.createSpan({ text: suggestion.projectTitle });
			content.createEl('strong', { text: suggestion.task });
			content.createEl('p', {
				text: suggestion.proposal
					? `可尝试：${this.formatSuggestion(suggestion.proposal)}`
					: '未来七天暂时没有找到完整的一小时。',
			});
			new Setting(card)
				.setClass('haidencyril-agenda-suggestion-action')
				.addButton((button) =>
					button.setButtonText('调整并确认').onClick(() => {
						this.close();
						this.onSchedule(suggestion.projectFile, suggestion.task);
					}),
				);
		}
	}

	private formatDay(date: Date): string {
		return new Intl.DateTimeFormat('zh-CN', {
			month: 'long',
			day: 'numeric',
			weekday: 'short',
		}).format(date);
	}

	private formatTimeRange(block: CalendarBlock): string {
		const formatter = new Intl.DateTimeFormat('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		return `${formatter.format(new Date(block.start))}–${formatter.format(new Date(block.end))}`;
	}

	private formatSuggestion(proposal: ScheduleProposal): string {
		const formatter = new Intl.DateTimeFormat('zh-CN', {
			weekday: 'short',
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
		return `${formatter.format(proposal.start)}，约 1 小时`;
	}

	private kindLabel(kind: CalendarBlock['kind']): string {
		if (kind === 'course') {
			return '课表';
		}
		if (kind === 'scheduled-work') {
			return '已确认行动';
		}
		return '日历';
	}
}
