import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type {
	Confidence,
	FragmentAnalysis,
	UserReflection,
} from '../domain/analysis';
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

export type ConnectionDecision = 'accepted' | 'rejected' | 'later';

export interface ReviewableConnection {
	targetFile: TFile;
	relation: string;
	reason: string;
	confidence: Confidence;
}

export interface ConnectionReview extends ReviewableConnection {
	decision: ConnectionDecision;
}

export interface ProjectDraft {
	title: string;
	goal: string;
	whyNow: string;
	successCriteria: string[];
	sourceFiles: TFile[];
	risks: string[];
	validations: string[];
	nextActions: string[];
}

export interface ProjectSummary {
	file: TFile;
	goal: string;
	nextAction: string;
	sourceCount: number;
	status: 'active' | 'completed';
	outcome: string;
}

export interface ProjectReview {
	outcome: string;
	evidence: string;
	lessons: string;
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

	getSemanticSearchFiles(): TFile[] {
		const settings = this.getSettings();
		const excludedPrefixes = [settings.analysisFolder, settings.scheduleFolder].map(
			(folder) => `${normalizePath(folder)}/`,
		);
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => !file.path.startsWith('.'))
			.filter(
				(file) => !excludedPrefixes.some((prefix) => file.path.startsWith(prefix)),
			)
			.sort((left, right) => right.stat.mtime - left.stat.mtime)
			.slice(0, 500);
	}

	async getProjects(): Promise<ProjectSummary[]> {
		const folder = normalizePath(this.getSettings().projectsFolder);
		const prefix = `${folder}/`;
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(prefix))
			.sort((left, right) => right.stat.mtime - left.stat.mtime);

		const projects = await Promise.all(
			files.map(async (file): Promise<ProjectSummary | null> => {
				const content = await this.app.vault.cachedRead(file);
				if (!/^haidencyril_type:\s*project\s*$/mu.test(content)) {
					return null;
				}
				const status = /^haidencyril_status:\s*completed\s*$/mu.test(content)
					? 'completed'
					: 'active';
				return {
					file,
					goal: this.sectionText(content, '目标') || '还没有写下项目目标。',
					nextAction:
						this.firstTask(content, '下一步行动') || '还没有写下下一步行动。',
					sourceCount: this.sectionWikiLinkCount(content, '来源碎片'),
					status,
					outcome: this.subsectionText(content, '实际结果'),
				};
			}),
		);
		return projects.filter(
			(project): project is ProjectSummary => project !== null,
		);
	}

	async createProject(draft: ProjectDraft): Promise<TFile> {
		const title = draft.title.trim();
		const goal = draft.goal.trim();
		const successCriteria = this.nonEmptyLines(draft.successCriteria);
		const nextActions = this.nonEmptyLines(draft.nextActions);
		const sourceFiles = [...new Map(
			draft.sourceFiles.map((file) => [file.path, file]),
		).values()];
		if (title.length === 0) {
			throw new Error('项目名称不能为空');
		}
		if (goal.length === 0) {
			throw new Error('请先写下项目目标');
		}
		if (successCriteria.length === 0) {
			throw new Error('请写下至少一条完成标准');
		}
		if (nextActions.length === 0) {
			throw new Error('请写下至少一个下一步行动');
		}
		if (sourceFiles.length === 0) {
			throw new Error('项目至少需要一条来源碎片');
		}

		const settings = this.getSettings();
		await this.ensureFolder(settings.projectsFolder);
		const path = await this.availablePath(settings.projectsFolder, title);
		const createdAt = new Date().toISOString();
		const sourceLinks = sourceFiles.map((file) =>
			`- ${this.app.fileManager.generateMarkdownLink(file, path)}`,
		);
		const risks = this.nonEmptyLines(draft.risks);
		const validations = this.nonEmptyLines(draft.validations);
		const markdown = `---
haidencyril_type: project
haidencyril_status: active
haidencyril_created: ${JSON.stringify(createdAt)}
---

# ${this.singleLine(title)}

> [!info] 项目边界
> 这份项目由你的判断推动。系统负责聚合碎片和保持结构，不替你决定目标或优先级。

## 为什么现在做

${draft.whyNow.trim() || '暂时没有单独说明。'}

## 目标

${goal}

## 完成标准

${successCriteria.map((item) => `- [ ] ${item}`).join('\n')}

## 来源碎片

${sourceLinks.join('\n')}

## 风险

${risks.length > 0 ? risks.map((item) => `- ${item}`).join('\n') : '- 暂未识别明确风险。'}

## 待验证

${validations.length > 0 ? validations.map((item) => `- [ ] ${item}`).join('\n') : '- 暂无。'}

## 下一步行动

${nextActions.map((item) => `- [ ] ${item}`).join('\n')}
`;

		return this.app.vault.create(path, markdown);
	}

	async completeProject(file: TFile, review: ProjectReview): Promise<void> {
		const outcome = review.outcome.trim();
		const lessons = review.lessons.trim();
		if (outcome.length === 0) {
			throw new Error('请写下实际发生了什么');
		}
		if (lessons.length === 0) {
			throw new Error('请写下至少一条值得保留的经验');
		}
		const completedAt = new Date().toISOString();
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				frontmatter['haidencyril_status'] = 'completed';
				frontmatter['haidencyril_completed'] = completedAt;
			},
		);
		const section = `## 完成复盘

完成时间：${completedAt}

### 实际结果

${outcome}

### 可核对的依据

${review.evidence.trim() || '暂时没有单独补充依据。'}

### 保留的经验

${lessons}
`;
		await this.app.vault.process(
			file,
			(content) => `${content.trimEnd()}\n\n${section}`,
		);
	}

	async reopenProject(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				frontmatter['haidencyril_status'] = 'active';
				delete frontmatter['haidencyril_completed'];
			},
		);
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

	async getPendingConnectionSuggestions(
		analysisFile: TFile,
	): Promise<ReviewableConnection[]> {
		const content = await this.app.vault.cachedRead(analysisFile);
		const lines = content.split('\n');
		const suggestionStart = lines.findIndex(
			(line) => line.trim() === '## 可能的联系',
		);
		if (suggestionStart < 0) {
			return [];
		}
		const suggestionEnd = this.nextSectionBoundary(lines, suggestionStart + 1);
		const reviewedTargets = this.reviewedConnectionPaths(
			lines,
			analysisFile,
		);
		const confidenceByLabel: Record<string, Confidence> = {
			低: 'low',
			中: 'medium',
			高: 'high',
		};
		const suggestions: ReviewableConnection[] = [];
		for (let index = suggestionStart + 1; index < suggestionEnd; index += 1) {
			const line = lines[index] ?? '';
			const match =
				/^- (?:- )?\[\[([^\]|]+)(?:\|[^\]]+)?\]\] · (.+?)（置信度：(低|中|高)）\s*$/u.exec(
					line,
				);
			if (!match?.[1] || !match[2] || !match[3]) {
				continue;
			}
			const targetFile = this.app.metadataCache.getFirstLinkpathDest(
				match[1],
				analysisFile.path,
			);
			if (!targetFile || reviewedTargets.has(targetFile.path)) {
				continue;
			}
			const reasonMatch = /^\s+-\s+(.+)$/u.exec(lines[index + 1] ?? '');
			suggestions.push({
				targetFile,
				relation: match[2],
				reason: reasonMatch?.[1] ?? '暂时没有补充说明。',
				confidence: confidenceByLabel[match[3]] ?? 'low',
			});
		}
		return suggestions;
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

	async recordConnectionReview(
		analysisFile: TFile,
		review: ConnectionReview,
	): Promise<void> {
		const decisionLabels: Record<ConnectionDecision, string> = {
			accepted: '已确认',
			rejected: '不采纳',
			later: '稍后判断',
		};
		const link = this.app.fileManager.generateMarkdownLink(
			review.targetFile,
			analysisFile.path,
		);
		const entry = [
			`- ${link} · ${decisionLabels[review.decision]}`,
			`  - 关系：${this.singleLine(review.relation)}`,
			`  - 说明：${this.singleLine(review.reason)}`,
		].join('\n');
		await this.app.vault.process(analysisFile, (content) =>
			this.insertUnderHeading(content, '你的关联判断', entry),
		);
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

	private nextSectionBoundary(lines: string[], start: number): number {
		for (let index = start; index < lines.length; index += 1) {
			const line = lines[index]?.trim();
			if (line?.startsWith('## ') || line === '---') {
				return index;
			}
		}
		return lines.length;
	}

	private reviewedConnectionPaths(
		lines: string[],
		analysisFile: TFile,
	): Set<string> {
		const reviewStart = lines.findIndex(
			(line) => line.trim() === '## 你的关联判断',
		);
		if (reviewStart < 0) {
			return new Set();
		}
		const reviewEnd = this.nextSectionBoundary(lines, reviewStart + 1);
		const paths = new Set<string>();
		for (let index = reviewStart + 1; index < reviewEnd; index += 1) {
			const match = /^- \[\[([^\]|]+)(?:\|[^\]]+)?\]\]/u.exec(
				lines[index] ?? '',
			);
			if (!match?.[1]) {
				continue;
			}
			const target = this.app.metadataCache.getFirstLinkpathDest(
				match[1],
				analysisFile.path,
			);
			if (target) {
				paths.add(target.path);
			}
		}
		return paths;
	}

	private sectionText(content: string, heading: string): string {
		const section = this.sectionContent(content, heading);
		return section
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.join(' ');
	}

	private subsectionText(content: string, heading: string): string {
		const lines = content.split('\n');
		let start = -1;
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (lines[index]?.trim() === `### ${heading}`) {
				start = index;
				break;
			}
		}
		if (start < 0) {
			return '';
		}
		let end = lines.length;
		for (let index = start + 1; index < lines.length; index += 1) {
			const line = lines[index]?.trim();
			if (line?.startsWith('## ') || line?.startsWith('### ')) {
				end = index;
				break;
			}
		}
		return lines
			.slice(start + 1, end)
			.map((line) => line.trim())
			.filter(Boolean)
			.join(' ');
	}

	private firstTask(content: string, heading: string): string {
		const section = this.sectionContent(content, heading);
		const match = /^- \[ \]\s+(.+)$/mu.exec(section);
		return match?.[1]?.trim() ?? '';
	}

	private sectionWikiLinkCount(content: string, heading: string): number {
		return (this.sectionContent(content, heading).match(/\[\[[^\]]+\]\]/gu) ?? [])
			.length;
	}

	private sectionContent(content: string, heading: string): string {
		const lines = content.split('\n');
		const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
		if (start < 0) {
			return '';
		}
		const end = this.nextSectionBoundary(lines, start + 1);
		return lines.slice(start + 1, end).join('\n').trim();
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

	private nonEmptyLines(values: string[]): string[] {
		return values.map((value) => this.singleLine(value)).filter(Boolean);
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
