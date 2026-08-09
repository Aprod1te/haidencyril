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
const MAX_SOURCE_CHARACTERS = 6000;

export class TaskPlanningService {
	async plan(
		file: TFile,
		content: string,
		goal: string,
		constraints: string,
		model: string,
	): Promise<TaskPlan> {
		const sourceContent = content.slice(0, MAX_SOURCE_CHARACTERS);
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
					options: { temperature: 0, num_ctx: 8192, num_predict: 640 },
					messages: [
						{
							role: 'system',
							content: `你是个人任务规划协作者。把零碎任务整理成用户可以检查和修改的有序清单。

规则：
1. 每一步必须以具体动词开头，并且能独立执行。
2. 给每一步写一个可观察的完成标准。
3. 按真实依赖顺序排列；通常 3 到 6 步，最多 8 步，不为凑数量拆分无意义步骤。
4. 不得编造日期、联系人答复、预算或其他未知事实。
5. 逐一处理用户写下的限制或不确定点：需要用户决定的放入 questions，可以调查获得的转成 task。
6. questions 必须是直接问用户的问题，不能写成行动建议；日期含义不明确时必须询问。
7. 只规划当前目标所需的动作，不扩展成不必要的大项目。
8. 行动和完成标准各用一句简洁短句，避免解释性段落。
9. 所有输出使用简体中文。`,
						},
						{
							role: 'user',
							content: JSON.stringify({
								source: { title: file.basename, content: sourceContent },
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
