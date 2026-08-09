import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { HaidencyrilSettings } from '../settings';

export interface ThemeSummary {
	file: TFile;
	title: string;
	statement: string;
	latestObservation: string;
	occurrenceCount: number;
}

export interface ThemeEvolutionDraft {
	themeFile: TFile | null;
	title: string;
	pattern: string;
	change: string;
	nextQuestion: string;
}

export class ThemeRepository {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => HaidencyrilSettings,
	) {}

	async getThemes(): Promise<ThemeSummary[]> {
		const folder = normalizePath(this.getSettings().themesFolder);
		const prefix = `${folder}/`;
		const summaries = await Promise.all(
			this.app.vault
				.getMarkdownFiles()
				.filter((file) => file.path.startsWith(prefix))
				.map(async (file): Promise<ThemeSummary | null> => {
					const content = await this.app.vault.cachedRead(file);
					if (!/^haidencyril_type:\s*theme\s*$/mu.test(content)) {
						return null;
					}
					return {
						file,
						title: /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() || file.basename,
						statement:
							this.sectionText(content, '当前理解') || '还没有写下当前理解。',
						latestObservation:
							this.latestField(content, '这次观察') || '还没有演化记录。',
						occurrenceCount: (content.match(/^###\s+/gmu) ?? []).length,
					};
				}),
		);
		return summaries
			.filter((theme): theme is ThemeSummary => theme !== null)
			.sort((left, right) => right.file.stat.mtime - left.file.stat.mtime);
	}

	async saveEvolution(
		projectFile: TFile,
		draft: ThemeEvolutionDraft,
	): Promise<TFile> {
		const title = this.singleLine(draft.title);
		const pattern = draft.pattern.trim();
		const nextQuestion = draft.nextQuestion.trim();
		if (!title) {
			throw new Error('请先给长期主题命名');
		}
		if (!pattern) {
			throw new Error('请写下这次看见的反复模式');
		}
		if (!nextQuestion) {
			throw new Error('请留下下一次需要继续观察的问题');
		}

		const existingThemes = await this.getThemes();
		let themeFile = draft.themeFile;
		if (themeFile) {
			const existing = existingThemes.find(
				(theme) => theme.file.path === themeFile?.path,
			);
			if (!existing) {
				throw new Error('选择的长期主题已经不存在');
			}
			if (this.linksTo(themeFile, projectFile)) {
				throw new Error('这个项目已经记录到该长期主题');
			}
		} else {
			if (
				existingThemes.some(
					(theme) => theme.title.toLocaleLowerCase() === title.toLocaleLowerCase(),
				)
			) {
				throw new Error('已经存在同名主题，请选择更新已有主题');
			}
			themeFile = await this.createTheme(title, pattern);
		}

		const timestamp = new Date().toISOString();
		const projectLink = this.app.fileManager.generateMarkdownLink(
			projectFile,
			themeFile.path,
		);
		const entry = `### ${this.formatDate(new Date())} · ${projectFile.basename}

来源项目：${projectLink}

**这次观察**

${pattern}

**相比过去**

${draft.change.trim() || '这是第一次记录，暂时没有可比较的变化。'}

**下次继续观察**

${nextQuestion}`;
		await this.app.vault.process(themeFile, (content) => {
			const updated = this.replaceSection(content, '当前理解', pattern);
			return this.insertUnderHeading(updated, '演化记录', entry);
		});
		await this.app.fileManager.processFrontMatter(
			themeFile,
			(frontmatter: Record<string, unknown>) => {
				frontmatter['haidencyril_updated'] = timestamp;
			},
		);
		const themeLink = this.app.fileManager.generateMarkdownLink(
			themeFile,
			projectFile.path,
		);
		await this.app.vault.process(projectFile, (content) =>
			this.insertUnderHeading(
				content,
				'长期主题',
				`- ${themeLink} · ${this.singleLine(pattern)}`,
			),
		);
		return themeFile;
	}

	private async createTheme(title: string, pattern: string): Promise<TFile> {
		const folder = normalizePath(this.getSettings().themesFolder);
		await this.ensureFolder(folder);
		const path = normalizePath(`${folder}/${this.sanitizeFilename(title)}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			throw new Error('同名主题文件已经存在，请换一个名称');
		}
		return this.app.vault.create(
			path,
			`---
haidencyril_type: theme
haidencyril_created: ${JSON.stringify(new Date().toISOString())}
---

# ${title}

> [!info] 主题边界
> 主题是由你确认的长期观察，不是模型裁决。当前理解可以随着新证据被修改。

## 当前理解

${pattern}

## 演化记录
`,
		);
	}

	private linksTo(sourceFile: TFile, targetFile: TFile): boolean {
		return (this.app.metadataCache.getFileCache(sourceFile)?.links ?? []).some(
			(link) =>
				this.app.metadataCache.getFirstLinkpathDest(
					link.link,
					sourceFile.path,
				)?.path === targetFile.path,
		);
	}

	private sectionText(content: string, heading: string): string {
		return this.sectionContent(content, heading)
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.join(' ');
	}

	private latestField(content: string, field: string): string {
		const matches = [...content.matchAll(new RegExp(`\\*\\*${field}\\*\\*\\s*\\n\\s*([^\\n]+)`, 'gu'))];
		return matches.at(-1)?.[1]?.trim() ?? '';
	}

	private sectionContent(content: string, heading: string): string {
		const lines = content.split('\n');
		const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
		if (start < 0) {
			return '';
		}
		let end = lines.length;
		for (let index = start + 1; index < lines.length; index += 1) {
			if (lines[index]?.trim().startsWith('## ')) {
				end = index;
				break;
			}
		}
		return lines.slice(start + 1, end).join('\n').trim();
	}

	private replaceSection(
		content: string,
		heading: string,
		replacement: string,
	): string {
		const headingLine = `## ${heading}`;
		const start = content.indexOf(headingLine);
		if (start < 0) {
			return `${content.trimEnd()}\n\n${headingLine}\n\n${replacement}\n`;
		}
		const bodyStart = start + headingLine.length;
		const nextHeading = /\n##\s+/u.exec(content.slice(bodyStart));
		const end = nextHeading ? bodyStart + nextHeading.index : content.length;
		return `${content.slice(0, bodyStart)}\n\n${replacement.trim()}\n${content.slice(end)}`;
	}

	private insertUnderHeading(
		content: string,
		heading: string,
		entry: string,
	): string {
		const headingLine = `## ${heading}`;
		const start = content.indexOf(headingLine);
		if (start < 0) {
			return `${content.trimEnd()}\n\n${headingLine}\n\n${entry}\n`;
		}
		const bodyStart = start + headingLine.length;
		const nextHeading = /\n##\s+/u.exec(content.slice(bodyStart));
		const end = nextHeading ? bodyStart + nextHeading.index : content.length;
		const before = content.slice(0, end).trimEnd();
		const after = content.slice(end).trimStart();
		return after ? `${before}\n\n${entry}\n\n${after}` : `${before}\n\n${entry}\n`;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const parts = normalizePath(folderPath).split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFile) {
				throw new Error(`${current} 已经是文件，无法创建同名目录`);
			}
			if (!(existing instanceof TFolder)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private formatDate(value: Date): string {
		return new Intl.DateTimeFormat('zh-CN', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(value);
	}

	private sanitizeFilename(value: string): string {
		return (
			value
				.replace(/[\\/:*?"<>|#^[\]]/gu, ' ')
				.replace(/\s+/gu, ' ')
				.trim()
				.slice(0, 80) || '未命名主题'
		);
	}

	private singleLine(value: string): string {
		return value.trim().replace(/\s+/gu, ' ');
	}
}
