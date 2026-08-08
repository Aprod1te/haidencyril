import { requestUrl, TFile } from 'obsidian';
import type { ConnectionCandidate } from '../data/fragment-repository';
import {
	analysisJsonSchema,
	analysisSchema,
	type FragmentAnalysis,
	type UserReflection,
} from '../domain/analysis';

interface ResponseContent {
	type?: string;
	text?: string;
}

interface ResponseOutput {
	type?: string;
	content?: ResponseContent[];
}

interface OpenAIResponse {
	output?: ResponseOutput[];
	error?: { message?: string };
}

export class OpenAIAnalysisService {
	async analyze(
		file: TFile,
		content: string,
		reflection: UserReflection,
		candidates: ConnectionCandidate[],
		apiKey: string,
		model: string,
	): Promise<FragmentAnalysis> {
		const candidatePayload = candidates.map((candidate) => ({
			path: candidate.path,
			title: candidate.title,
			excerpt: candidate.excerpt,
		}));
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/responses',
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				store: false,
				input: [
					{
						role: 'system',
						content: [
							{
								type: 'input_text',
								text: `你是个人知识库中的分析协作者。你的任务是帮助用户思考，而不是替用户裁决。

规则：
1. 严格区分原文事实、解释性假设和未知信息。
2. 事实必须能在原始碎片中直接找到依据；否则放入 interpretations 或 unknowns。
3. 不输出隐藏思维过程，只输出简洁、可核对的分析摘要。
4. 最多提出 3 个真正能推动用户思考的问题。
5. 联系只能引用候选笔记中给出的完整 path，不能编造路径。
6. 模糊反馈只能形成待验证假设，不能直接当作核心问题。
7. 对照用户自己的初步判断：指出哪些地方有证据支持，哪些地方值得反驳或验证。不要仅仅附和用户。
8. 所有输出使用简体中文。`,
							},
						],
					},
					{
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: JSON.stringify({
									source: { path: file.path, content },
									userReflection: reflection,
									connectionCandidates: candidatePayload,
								}),
							},
						],
					},
				],
				text: {
					format: {
						type: 'json_schema',
						name: 'fragment_analysis',
						strict: true,
						schema: analysisJsonSchema,
					},
				},
			}),
			throw: false,
		});

		const payload = response.json as OpenAIResponse;
		if (response.status >= 400) {
			throw new Error(payload.error?.message ?? `OpenAI 请求失败（${response.status}）`);
		}

		const outputText = payload.output
			?.flatMap((output) => output.content ?? [])
			.find((item) => item.type === 'output_text')?.text;
		if (!outputText) {
			throw new Error('OpenAI 没有返回可解析的分析结果');
		}

		const analysis = analysisSchema.parse(JSON.parse(outputText));
		const candidatePaths = new Set(candidates.map((candidate) => candidate.path));
		return {
			...analysis,
			connections: analysis.connections.filter((connection) =>
				candidatePaths.has(connection.notePath),
			),
		};
	}
}
