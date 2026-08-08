import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { CalendarBlock, ScheduleProposal } from '../domain/schedule';
import type { HaidencyrilSettings } from '../settings';

const EVENT_MARKER = '<!-- haidencyril_event ';

export class ScheduleRepository {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => HaidencyrilSettings,
	) {}

	async saveImportedCourses(
		blocks: CalendarBlock[],
		sourceName: string,
	): Promise<TFile> {
		if (blocks.length === 0) {
			throw new Error('这个日历文件中没有未来七个月内的课程或活动');
		}
		const folder = normalizePath(`${this.getSettings().scheduleFolder}/Courses`);
		await this.ensureFolder(folder);
		const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
		const path = normalizePath(`${folder}/课表导入 - ${timestamp}.md`);
		const rows = blocks.map((block) => {
			const location = block.location ? ` @ ${block.location}` : '';
			return `- ${this.formatRange(block)} · ${block.title}${location}\n  ${EVENT_MARKER}${JSON.stringify(block)} -->`;
		});
		return this.app.vault.create(
			path,
			`---
haidencyril_type: course_import
haidencyril_created: ${JSON.stringify(new Date().toISOString())}
---

# 导入课表

来源：${sourceName}

> [!info] 使用规则
> 这些时间默认受到保护。临时补课可以重新导入日历，或先记录成碎片后再安排。

## 固定安排

${rows.join('\n')}
`,
		);
	}

	async getBusyBlocks(): Promise<CalendarBlock[]> {
		return this.deduplicate([
			...(await this.getLatestCourses()),
			...(await this.getLatestCalendarSnapshot()),
			...(await this.getScheduledWork()),
		]);
	}

	async getAgendaBlocks(): Promise<CalendarBlock[]> {
		const now = new Date();
		const end = new Date(now);
		end.setDate(end.getDate() + 8);
		return (await this.getBusyBlocks())
			.filter((block) => new Date(block.end) >= now)
			.filter((block) => new Date(block.start) <= end)
			.sort(
				(left, right) =>
					new Date(left.start).getTime() - new Date(right.start).getTime(),
			);
	}

	async saveCalendarSnapshot(
		blocks: CalendarBlock[],
		sourceName: string,
	): Promise<TFile> {
		const folder = normalizePath(`${this.getSettings().scheduleFolder}/Calendar`);
		await this.ensureFolder(folder);
		const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
		const path = normalizePath(`${folder}/苹果日历同步 - ${timestamp}.md`);
		const rows = blocks.map((block) => {
			const location = block.location ? ` @ ${block.location}` : '';
			return `- ${this.formatRange(block)} · ${block.title}${location}\n  ${EVENT_MARKER}${JSON.stringify(block)} -->`;
		});
		return this.app.vault.create(
			path,
			`---
haidencyril_type: calendar_snapshot
haidencyril_created: ${JSON.stringify(new Date().toISOString())}
---

# 苹果日历同步

来源：${sourceName}

> [!info] 同步边界
> 这是苹果日历未来八天的只读快照。插件不会静默修改已有日历事件。

## 日程

${rows.length > 0 ? rows.join('\n') : '- 未来八天没有日程。'}
`,
		);
	}

	async createScheduleDraft(
		projectFile: TFile,
		proposal: ScheduleProposal,
	): Promise<TFile> {
		const folder = normalizePath(`${this.getSettings().scheduleFolder}/Drafts`);
		await this.ensureFolder(folder);
		const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
		const safeTitle = this.sanitizeFilename(proposal.title);
		const path = normalizePath(`${folder}/${safeTitle} - ${timestamp}.md`);
		const projectLink = this.app.fileManager.generateMarkdownLink(
			projectFile,
			path,
		);
		const conflicts =
			proposal.conflicts.length > 0
				? proposal.conflicts
						.map((block) => `- ${this.formatRange(block)} · ${block.title}`)
						.join('\n')
				: '- 无';
		const file = await this.app.vault.create(
			path,
			`---
haidencyril_type: schedule_draft
haidencyril_status: confirmed
haidencyril_created: ${JSON.stringify(new Date().toISOString())}
---

# ${proposal.title}

项目：${projectLink}

开始：${proposal.start.toISOString()}

结束：${proposal.end.toISOString()}

优先级：${proposal.priority === 'high' ? '高' : '普通'}

## 冲突确认

${conflicts}
`,
		);
		const link = this.app.fileManager.generateMarkdownLink(file, projectFile.path);
		await this.app.vault.process(projectFile, (content) =>
			this.insertUnderHeading(
				content,
				'日程安排',
				`- ${link} · ${this.formatRange({
					title: proposal.title,
					start: proposal.start.toISOString(),
					end: proposal.end.toISOString(),
					location: '',
					kind: 'scheduled-work',
				})}`,
			),
		);
		return file;
	}

	private async getLatestCourses(): Promise<CalendarBlock[]> {
		const latest = this.latestFile('Courses');
		if (!latest) {
			return [];
		}
		return this.parseEventMarkers(await this.app.vault.cachedRead(latest));
	}

	private async getLatestCalendarSnapshot(): Promise<CalendarBlock[]> {
		const latest = this.latestFile('Calendar');
		if (!latest) {
			return [];
		}
		return this.parseEventMarkers(await this.app.vault.cachedRead(latest));
	}

	private latestFile(subfolder: string): TFile | null {
		const folder = normalizePath(
			`${this.getSettings().scheduleFolder}/${subfolder}`,
		);
		const prefix = `${folder}/`;
		return (
			this.app.vault
				.getMarkdownFiles()
				.filter((file) => file.path.startsWith(prefix))
				.sort((left, right) => right.stat.mtime - left.stat.mtime)[0] ?? null
		);
	}

	private async getScheduledWork(): Promise<CalendarBlock[]> {
		const folder = normalizePath(`${this.getSettings().scheduleFolder}/Drafts`);
		const prefix = `${folder}/`;
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(prefix));
		const blocks = await Promise.all(
			files.map(async (file): Promise<CalendarBlock | null> => {
				const content = await this.app.vault.cachedRead(file);
				const start = /^开始：(.+)$/mu.exec(content)?.[1]?.trim();
				const end = /^结束：(.+)$/mu.exec(content)?.[1]?.trim();
				if (!start || !end) {
					return null;
				}
				return {
					title: file.basename.replace(/ - \d{4}-.*$/u, ''),
					start,
					end,
					location: '',
					kind: 'scheduled-work',
				};
			}),
		);
		return blocks.filter((block): block is CalendarBlock => block !== null);
	}

	private parseEventMarkers(content: string): CalendarBlock[] {
		const blocks: CalendarBlock[] = [];
		for (const line of content.split('\n')) {
			const start = line.indexOf(EVENT_MARKER);
			if (start < 0) {
				continue;
			}
			const raw = line.slice(start + EVENT_MARKER.length).replace(/\s*-->\s*$/u, '');
			try {
				const parsed = JSON.parse(raw) as Partial<CalendarBlock>;
				if (
					typeof parsed.title === 'string' &&
					typeof parsed.start === 'string' &&
					typeof parsed.end === 'string'
				) {
					blocks.push({
						title: parsed.title,
						start: parsed.start,
						end: parsed.end,
						location: parsed.location ?? '',
						kind: parsed.kind ?? 'course',
					});
				}
			} catch {
				continue;
			}
		}
		return blocks;
	}

	private deduplicate(blocks: CalendarBlock[]): CalendarBlock[] {
		const unique = new Map<string, CalendarBlock>();
		for (const block of blocks) {
			const key = `${block.title.trim()}\u0000${block.start}\u0000${block.end}`;
			unique.set(key, block);
		}
		return [...unique.values()];
	}

	private formatRange(block: CalendarBlock): string {
		const formatter = new Intl.DateTimeFormat('zh-CN', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
		const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
		});
		return `${formatter.format(new Date(block.start))}–${timeFormatter.format(new Date(block.end))}`;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const parts = normalizePath(folderPath).split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current.length === 0 ? part : `${current}/${part}`;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFile) {
				throw new Error(`${current} 已经是文件，无法创建同名目录`);
			}
			if (!(existing instanceof TFolder)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private sanitizeFilename(value: string): string {
		return (
			value
				.replace(/[\\/:*?"<>|#^[\]]/gu, ' ')
				.replace(/\s+/gu, ' ')
				.trim()
				.slice(0, 70) || '未命名行动'
		);
	}

	private insertUnderHeading(
		content: string,
		heading: string,
		entry: string,
	): string {
		const headingLine = `## ${heading}`;
		const headingIndex = content.indexOf(headingLine);
		if (headingIndex < 0) {
			return `${content.trimEnd()}\n\n${headingLine}\n\n${entry}\n`;
		}
		const sectionStart = headingIndex + headingLine.length;
		const followingContent = content.slice(sectionStart);
		const nextHeadingMatch = /\n##\s+/u.exec(followingContent);
		const insertionIndex = nextHeadingMatch
			? sectionStart + nextHeadingMatch.index
			: content.length;
		const before = content.slice(0, insertionIndex).trimEnd();
		const after = content.slice(insertionIndex).trimStart();
		return after.length > 0
			? `${before}\n${entry}\n\n${after}`
			: `${before}\n${entry}\n`;
	}
}
