import { App, normalizePath, requestUrl, TFile } from 'obsidian';
import { z } from 'zod';
import type { FragmentRepository } from '../data/fragment-repository';

interface SemanticIndexEntry {
	path: string;
	mtime: number;
	embedding: number[];
}

interface SemanticIndex {
	model: string;
	entries: SemanticIndexEntry[];
}

export interface SemanticSearchResult {
	file: TFile;
	excerpt: string;
	score: number;
}

const embedResponseSchema = z.object({
	embeddings: z.array(z.array(z.number())),
});

export class SemanticSearchService {
	private readonly indexPath: string;

	constructor(
		private readonly app: App,
		private readonly repository: FragmentRepository,
	) {
		this.indexPath = normalizePath(
			`${app.vault.configDir}/plugins/haidencyril/semantic-index.json`,
		);
	}

	async search(
		query: string,
		model: string,
		limit = 8,
	): Promise<SemanticSearchResult[]> {
		const normalizedQuery = query.trim();
		if (normalizedQuery.length === 0) {
			return [];
		}

		const files = this.repository.getSemanticSearchFiles();
		const documents = await Promise.all(
			files.map(async (file) => ({
				file,
				content: await this.repository.readBody(file),
			})),
		);
		const index = await this.ensureIndex(documents, model);
		const [queryEmbedding] = await this.embed(
			[`检索任务：找到与这个问题语义相关的个人笔记。\n查询：${normalizedQuery}`],
			model,
		);
		if (!queryEmbedding) {
			throw new Error('本地模型没有返回查询向量');
		}

		const entryByPath = new Map(index.entries.map((entry) => [entry.path, entry]));
		return documents
			.map(({ file, content }): SemanticSearchResult | null => {
				const entry = entryByPath.get(file.path);
				if (!entry) {
					return null;
				}
				return {
					file,
					excerpt: content.slice(0, 280),
					score: this.cosineSimilarity(queryEmbedding, entry.embedding),
				};
			})
			.filter((result): result is SemanticSearchResult => result !== null)
			.sort((left, right) => right.score - left.score)
			.slice(0, limit);
	}

	async rebuild(model: string): Promise<number> {
		const files = this.repository.getSemanticSearchFiles();
		const documents = await Promise.all(
			files.map(async (file) => ({
				file,
				content: await this.repository.readBody(file),
			})),
		);
		const entries = await this.embedDocuments(documents, model);
		await this.writeIndex({ model, entries });
		return entries.length;
	}

	private async ensureIndex(
		documents: Array<{ file: TFile; content: string }>,
		model: string,
	): Promise<SemanticIndex> {
		const saved = await this.readIndex();
		const existing =
			saved?.model === model
				? new Map(saved.entries.map((entry) => [entry.path, entry]))
				: new Map<string, SemanticIndexEntry>();
		const currentPaths = new Set(documents.map(({ file }) => file.path));
		const retained = [...existing.values()].filter(
			(entry) =>
				currentPaths.has(entry.path) &&
				documents.some(
					({ file }) => file.path === entry.path && file.stat.mtime === entry.mtime,
				),
		);
		const retainedPaths = new Set(retained.map((entry) => entry.path));
		const changed = documents.filter(({ file }) => !retainedPaths.has(file.path));
		const entries = [...retained, ...(await this.embedDocuments(changed, model))];
		const index = { model, entries };
		if (
			changed.length > 0 ||
			!saved ||
			saved.entries.length !== entries.length ||
			saved.model !== model
		) {
			await this.writeIndex(index);
		}
		return index;
	}

	private async embedDocuments(
		documents: Array<{ file: TFile; content: string }>,
		model: string,
	): Promise<SemanticIndexEntry[]> {
		const entries: SemanticIndexEntry[] = [];
		for (let offset = 0; offset < documents.length; offset += 12) {
			const batch = documents.slice(offset, offset + 12);
			const inputs = batch.map(
				({ file, content }) => `${file.basename}\n\n${content.slice(0, 6000)}`,
			);
			const embeddings = await this.embed(inputs, model);
			for (let index = 0; index < batch.length; index += 1) {
				const document = batch[index];
				const embedding = embeddings[index];
				if (document && embedding) {
					entries.push({
						path: document.file.path,
						mtime: document.file.stat.mtime,
						embedding,
					});
				}
			}
		}
		return entries;
	}

	private async embed(inputs: string[], model: string): Promise<number[][]> {
		if (inputs.length === 0) {
			return [];
		}
		try {
			const response = await requestUrl({
				url: 'http://127.0.0.1:11434/api/embed',
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({ model, input: inputs, truncate: true }),
			});
			return embedResponseSchema.parse(response.json).embeddings;
		} catch (error) {
			const detail = error instanceof Error ? `：${error.message}` : '';
			throw new Error(
				`无法生成本地语义索引。请确认 Ollama 正在运行，并执行 ollama pull ${model}${detail}`,
			);
		}
	}

	private async readIndex(): Promise<SemanticIndex | null> {
		try {
			if (!(await this.app.vault.adapter.exists(this.indexPath))) {
				return null;
			}
			const parsed: unknown = JSON.parse(
				await this.app.vault.adapter.read(this.indexPath),
			);
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				!('model' in parsed) ||
				!('entries' in parsed) ||
				typeof parsed.model !== 'string' ||
				!Array.isArray(parsed.entries)
			) {
				return null;
			}
			return parsed as SemanticIndex;
		} catch {
			return null;
		}
	}

	private async writeIndex(index: SemanticIndex): Promise<void> {
		await this.app.vault.adapter.write(
			this.indexPath,
			JSON.stringify(index),
		);
	}

	private cosineSimilarity(left: number[], right: number[]): number {
		const size = Math.min(left.length, right.length);
		let dot = 0;
		let leftNorm = 0;
		let rightNorm = 0;
		for (let index = 0; index < size; index += 1) {
			const leftValue = left[index] ?? 0;
			const rightValue = right[index] ?? 0;
			dot += leftValue * rightValue;
			leftNorm += leftValue * leftValue;
			rightNorm += rightValue * rightValue;
		}
		const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
		return denominator === 0 ? 0 : dot / denominator;
	}
}
