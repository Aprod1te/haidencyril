import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { FragmentAnalysis, UserReflection } from '../domain/analysis';
import { renderAnalysisMarkdown } from '../domain/analysis';
import type { HaidencyrilSettings } from '../settings';

export interface ConnectionCandidate {
	path: string;
	title: string;
	excerpt: string;
	score: number;
}

export class FragmentRepository {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => HaidencyrilSettings,
	) {}

	async createFragment(content: string): Promise<TFile> {
		const normalizedContent = content.trim();
		if (normalizedContent.length === 0) {
			throw new Error('碎片内容不能为空');
		}

		const settings = this.getSettings();
		await this.ensureFolder(settings.inboxFolder);
		const createdAt = new Date().toISOString();
		const id = `fragment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const title = this.makeTitle(normalizedContent);
		const path = await this.availablePath(settings.inboxFolder, title);
		const markdown = `---
haidencyril_id: ${id}
haidencyril_type: fragment
haidencyril_status: inbox
haidencyril_created: ${JSON.stringify(createdAt)}
haidencyril_source: manual
---

# ${title}

${normalizedContent}
`;

		return this.app.vault.create(path, markdown);
	}

	getInboxFiles(): TFile[] {
		const folder = normalizePath(this.getSettings().inboxFolder);
		const prefix = `${folder}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(prefix))
			.sort((left, right) => right.stat.mtime - left.stat.mtime);
	}

	async readBody(file: TFile): Promise<string> {
		const content = await this.app.vault.cachedRead(file);
		return content
			.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, '')
			.replace(/^#\s+.*\n+/u, '')
			.trim();
	}

	async findConnectionCandidates(
		sourceFile: TFile,
		sourceContent: string,
		limit = 4,
	): Promise<ConnectionCandidate[]> {
		const analysisPrefix = `${normalizePath(this.getSettings().analysisFolder)}/`;
		const sourceTerms = this.termSet(sourceContent);
		if (sourceTerms.size === 0) {
			return [];
		}

		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path !== sourceFile.path)
			.filter((file) => !file.path.startsWith(analysisPrefix))
			.sort((left, right) => right.stat.mtime - left.stat.mtime)
			.slice(0, 200);

		const candidates = await Promise.all(
			files.map(async (file): Promise<ConnectionCandidate | null> => {
				const body = await this.readBody(file);
				const terms = this.termSet(body);
				const overlap = [...sourceTerms].filter((term) => terms.has(term)).length;
				if (overlap === 0) {
					return null;
				}
				const score = overlap / Math.sqrt(sourceTerms.size * Math.max(terms.size, 1));
				return {
					path: file.path,
					title: file.basename,
					excerpt: body.slice(0, 600),
					score,
				};
			}),
		);

		return candidates
			.filter((candidate): candidate is ConnectionCandidate => candidate !== null)
			.sort((left, right) => right.score - left.score)
			.slice(0, limit);
	}

	async createAnalysis(
		sourceFile: TFile,
		analysis: FragmentAnalysis,
		reflection: UserReflection,
		model: string,
	): Promise<TFile> {
		const settings = this.getSettings();
		await this.ensureFolder(settings.analysisFolder);
		const createdAt = new Date().toISOString();
		const timestamp = createdAt.replace(/[:.]/gu, '-');
		const filename = this.sanitizeFilename(`${sourceFile.basename} - ${timestamp}`);
		const path = normalizePath(`${settings.analysisFolder}/${filename}.md`);
		const markdown = renderAnalysisMarkdown(
			analysis,
			reflection,
			sourceFile.path,
			model,
			createdAt,
		);
		const analysisFile = await this.app.vault.create(path, markdown);

		await this.app.fileManager.processFrontMatter(
			sourceFile,
			(frontmatter: Record<string, unknown>) => {
				frontmatter['haidencyril_status'] = 'analyzed';
				frontmatter['haidencyril_analysis'] = analysisFile.path;
				const history = this.stringArray(
					frontmatter['haidencyril_analyses'],
				);
				history.push(analysisFile.path);
				frontmatter['haidencyril_analyses'] = history;
			},
		);

		return analysisFile;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		const parts = normalized.split('/').filter(Boolean);
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

	private async availablePath(folder: string, title: string): Promise<string> {
		const safeTitle = this.sanitizeFilename(title);
		let suffix = 0;
		while (true) {
			const filename = suffix === 0 ? safeTitle : `${safeTitle} ${suffix + 1}`;
			const path = normalizePath(`${folder}/${filename}.md`);
			if (!this.app.vault.getAbstractFileByPath(path)) {
				return path;
			}
			suffix += 1;
		}
	}

	private makeTitle(content: string): string {
		const firstLine = content.split('\n').find((line) => line.trim().length > 0);
		return (firstLine ?? '未命名碎片').replace(/^#+\s*/u, '').trim().slice(0, 42);
	}

	private sanitizeFilename(value: string): string {
		return value
			.replace(/[\\/:*?"<>|#^[\]]/gu, ' ')
			.replace(/\s+/gu, ' ')
			.trim()
			.slice(0, 80) || '未命名碎片';
	}

	private termSet(content: string): Set<string> {
		const normalized = content.toLocaleLowerCase();
		const terms = new Set<string>();
		for (const word of normalized.match(/[a-z0-9]{3,}/gu) ?? []) {
			terms.add(word);
		}
		for (const chunk of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
			for (let index = 0; index < chunk.length - 1; index += 1) {
				terms.add(chunk.slice(index, index + 2));
			}
		}
		return terms;
	}

	private stringArray(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.filter(
			(item: unknown): item is string => typeof item === 'string',
		);
	}
}
