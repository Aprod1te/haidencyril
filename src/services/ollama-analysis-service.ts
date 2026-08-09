import { requestUrl, TFile } from 'obsidian';
import type { ConnectionCandidate } from '../data/fragment-repository';
import {
	analysisJsonSchema,
	analysisSchema,
	type FragmentAnalysis,
	type UserReflection,
} from '../domain/analysis';

interface OllamaResponse {
	message?: { content?: string };
	error?: string;
}

const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';

export class OllamaAnalysisService {
	async analyze(
		file: TFile,
		content: string,
		reflection: UserReflection,
		candidates: ConnectionCandidate[],
		model: string,
	): Promise<FragmentAnalysis> {
		const candidatePayload = candidates.map((candidate) => ({
			path: candidate.path,
			title: candidate.title,
			excerpt: candidate.excerpt,
		}));

		let response;
		try {
			response = await requestUrl({
				url: OLLAMA_CHAT_URL,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model,
					stream: false,
					think: false,
					format: analysisJsonSchema,
					options: { temperature: 0 },
					messages: [
						{
							role: 'system',
							content: `你是个人知识库中的分析协作者。你的任务是帮助用户思考，而不是替用户裁决。

规则：
1. 严格区分原文事实、解释性假设和未知信息。
2. 事实必须能在原始碎片中直接找到依据；否则放入 interpretations 或 unknowns。
3. 不输出隐藏思维过程，只输出简洁、可核对的分析摘要。
4. 最多提出 3 个真正能推动用户思考的问题。
5. 联系只能引用候选笔记中给出的完整 path，不能编造路径。
6. 模糊反馈只能形成待验证假设，不能直接当作核心问题。
7. 对照用户自己的初步判断：指出哪些地方有证据支持，哪些地方值得反驳或验证。不要仅仅附和用户。
8. 如果记录包含需要执行的任务，在 nextActions 中按依赖顺序列出最多 8 个具体动作及可观察的完成标准；不要编造日期或未知条件。非行动型记录返回空数组。
9. 所有输出使用简体中文。`,
						},
						{
							role: 'user',
							content: JSON.stringify({
								source: { path: file.path, content },
								userReflection: reflection,
								connectionCandidates: candidatePayload,
							}),
						},
					],
				}),
				throw: false,
			});
		} catch {
			throw new Error('无法连接本地 Ollama，请确认 Ollama 已启动');
		}

		const payload = response.json as OllamaResponse;
		if (response.status >= 400) {
			throw new Error(payload.error ?? `Ollama 请求失败（${response.status}）`);
		}
		if (!payload.message?.content) {
			throw new Error('Ollama 没有返回可解析的分析结果');
		}

		const analysis = analysisSchema.parse(JSON.parse(payload.message.content));
		const candidatePaths = new Set(candidates.map((candidate) => candidate.path));
		return {
			...analysis,
			connections: analysis.connections.filter((connection) =>
				candidatePaths.has(connection.notePath),
			),
		};
	}
}
