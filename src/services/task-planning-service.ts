import { requestUrl, TFile } from 'obsidian';
import {
	taskPlanJsonSchema,
	taskPlanSchema,
	type TaskPlan,
} from '../domain/task-plan';

interface OllamaResponse {
	message?: { content?: string };
	error?: string;
}

const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';

export class TaskPlanningService {
	async plan(
		file: TFile,
		content: string,
		goal: string,
		constraints: string,
		model: string,
	): Promise<TaskPlan> {
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
					format: taskPlanJsonSchema,
					options: { temperature: 0 },
					messages: [
						{
							role: 'system',
							content: `你是个人任务规划协作者。把零碎任务整理成用户可以检查和修改的有序清单。

规则：
1. 每一步必须以具体动词开头，并且能独立执行。
2. 给每一步写一个可观察的完成标准。
3. 按真实依赖顺序排列，最多 8 步；不要为了凑数量拆分无意义步骤。
4. 不得编造日期、联系人答复、预算或其他未知事实。
5. 日期含义、交付条件等信息不明确时放入 questions，不能自行决定。
6. 只规划当前目标所需的动作，不扩展成不必要的大项目。
7. 所有输出使用简体中文。`,
						},
						{
							role: 'user',
							content: JSON.stringify({
								source: { path: file.path, content },
								goal,
								constraints,
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
			throw new Error('Ollama 没有返回可解析的任务清单');
		}
		return taskPlanSchema.parse(JSON.parse(payload.message.content));
	}
}
