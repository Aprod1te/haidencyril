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

export interface ManualConnection {
	targetFile: TFile;
	relation: string;
	reason: string;
}

export type AnalysisHistory = Map<string, TFile[]>;

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
		const title = this.makeTitle(normalizedContent);
		const path = await this.availablePath(settings.inboxFolder, title);
		const markdown = `---
haidencyril_status: inbox
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

	async getAnalysisHistory(): Promise<AnalysisHistory> {
		const folder = normalizePath(this.getSettings().analysisFolder);
		const prefix = `${folder}/`;
		const analysisFiles = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(prefix));
		const sources = await Promise.all(
			analysisFiles.map(async (file) => ({
				file,
				source: this.analysisSource(
					await this.app.vault.cachedRead(file),
					file,
				),
			})),
		);
		const history: AnalysisHistory = new Map();
		for (const { file, source } of sources) {
			if (!source) {
				continue;
			}
			const files = history.get(source.path) ?? [];
			files.push(file);
			history.set(source.path, files);
		}
		for (const files of history.values()) {
			files.sort((left, right) => right.stat.ctime - left.stat.ctime);
		}
		return history;
	}

	async readBody(file: TFile): Promise<string> {
		const content = await this.app.vault.cachedRead(file);
		const body = content
			.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, '')
			.replace(/^#\s+.*\n+/u, '');
		return (body.split(/^## 手动关联\s*$/mu, 1)[0] ?? '').trim();
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
				this.removeLegacyFragmentMetadata(frontmatter);
			},
		);

		return analysisFile;
	}

	async addManualConnection(
		sourceFile: TFile,
		connection: ManualConnection,
	): Promise<boolean> {
		const existingLinks = this.app.metadataCache.getFileCache(sourceFile)?.links ?? [];
		const alreadyLinked = existingLinks.some((link) => {
			const destination = this.app.metadataCache.getFirstLinkpathDest(
				link.link,
				sourceFile.path,
			);
			return destination?.path === connection.targetFile.path;
		});
		if (alreadyLinked) {
			return false;
		}

		const relation = this.singleLine(connection.relation);
		const reason = this.singleLine(connection.reason);
		const link = this.app.fileManager.generateMarkdownLink(
			connection.targetFile,
			sourceFile.path,
		);
		const entry = `- ${link} · ${relation}\n  - ${reason}`;
		await this.app.vault.process(sourceFile, (content) =>
			this.insertUnderHeading(content, '手动关联', entry),
		);
		return true;
	}

	async removeLegacyPathMetadata(): Promise<void> {
		const settings = this.getSettings();
		const inboxPrefix = `${normalizePath(settings.inboxFolder)}/`;
		const analysisPrefix = `${normalizePath(settings.analysisFolder)}/`;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (
				file.path.startsWith(inboxPrefix) &&
				frontmatter &&
				this.hasLegacyFragmentMetadata(frontmatter)
			) {
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						this.removeLegacyFragmentMetadata(frontmatter);
					},
				);
			}
			if (
				file.path.startsWith(analysisPrefix) &&
				frontmatter &&
				Object.prototype.hasOwnProperty.call(
					frontmatter,
					'haidencyril_source',
				)
			) {
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						delete frontmatter['haidencyril_source'];
					},
				);
			}
		}
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

	private analysisSource(content: string, analysisFile: TFile): TFile | null {
		const match = /^原始碎片：\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*$/mu.exec(content);
		if (!match?.[1]) {
			return null;
		}
		return this.app.metadataCache.getFirstLinkpathDest(
			match[1],
			analysisFile.path,
		);
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

	private removeLegacyFragmentMetadata(
		frontmatter: Record<string, unknown>,
	): void {
		delete frontmatter['haidencyril_id'];
		delete frontmatter['haidencyril_type'];
		delete frontmatter['haidencyril_created'];
		delete frontmatter['haidencyril_source'];
		delete frontmatter['haidencyril_analysis'];
		delete frontmatter['haidencyril_analyses'];
	}

	private hasLegacyFragmentMetadata(
		frontmatter: Record<string, unknown>,
	): boolean {
		return [
			'haidencyril_id',
			'haidencyril_type',
			'haidencyril_created',
			'haidencyril_source',
			'haidencyril_analysis',
			'haidencyril_analyses',
		].some((key) => Object.prototype.hasOwnProperty.call(frontmatter, key));
	}

	private singleLine(value: string): string {
		return value.trim().replace(/\s+/gu, ' ');
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
