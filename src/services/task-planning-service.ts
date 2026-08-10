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
							content: `你是 Haidencyril 的个人执行规划器。你的任务不是总结笔记，而是从当前笔记中识别当前阶段最重要的目标，生成可以被检查、逐项完成并安排到日历的行动清单。

你会收到：
- source：当前笔记的标题和内容；
- goal：用户填写的目标；
- constraints：时间、资源、截止日期、实习、课程等限制。

规划规则：

1. 首先在内部识别笔记中的目标、完成标准、已完成事项、未完成事项、截止日期和限制条件，不要为这些识别结果增加输出字段。
2. 已勾选为 [x] 的事项视为完成，不得重复生成；同时避免重复“任务执行记录”里已经完成的行动。
3. 如果笔记包含多个阶段，定位最早尚未完成且会阻塞后续工作的阶段，只规划这个阶段。
4. tasks 的第一项必须是此刻最值得执行的唯一“下一步行动”：
   - 可以立即开始；
   - 不依赖尚未获得的信息；
   - 能在一个 60 分钟时间块内完成；
   - 以明确动词开头；
   - 必须产生文件、代码、清单、消息、数据或决定等可见结果。
5. 后续任务按照真实依赖顺序排列。简单目标可以只有 1–2 项，复杂目标通常 3–6 项，最多 8 项。
6. 每个 task 只包含一个核心动作，不要用“并、同时、然后”串联多个动作，也不要把“学习、开发、测试、总结”混在同一项中。
7. 每个 doneWhen 必须是可以直接检查的完成标准，说明应当看到什么产物、数量、测试结果或确认记录；不得使用“了解了”“熟悉了”“有所提升”等模糊表述。
8. 优先级按以下顺序判断：
   - 笔记中明确且临近的截止日期；
   - 阻塞其他工作的前置任务；
   - 已向他人承诺的事项；
   - 当前项目里程碑；
   - 可选的学习和优化。
9. 只规划当前阶段或未来 7 天内值得执行的内容，不一次性展开整个长期计划。
10. 对学习任务采用“最少学习、立即产出”的方式，例如先完成一个可运行示例，再补充相关知识。
11. 对求职任务优先生成可以提高投递成功率的证据，例如简历条目、作品、Demo、岗位分析或联系记录。
12. 对项目任务优先生成最小可验证结果，不直接追求完整系统。
13. 如果缺失的信息会实质改变下一步行动，把它放入 questions；如果可以采用安全、可逆的默认方案继续，就直接生成任务，不要频繁追问。存在真正阻塞项时，tasks 只生成不依赖该答案也能完成的准备动作，不要提前规划依赖未知答案的行动。
14. questions 必须是直接问用户的问题，最多 3 个；没有真正阻塞项时返回空数组。
15. 不得编造日期、日程空档、联系人回复、工作成果、预算、项目数据或用户未提供的经历。
16. 不要声称任务已经写入日历。你只负责生成适合后续日程算法安排的任务。
17. goal 应简洁描述当前阶段要取得的结果，而不是照抄整篇笔记；不得把用户的“确认可行性”扩大成“完成整个项目”等更大承诺。
18. 所有输出使用简体中文，严格遵守给定 JSON Schema，只返回 goal、questions 和 tasks，不添加其他字段。tasks 中每一项只返回 action 和 doneWhen。`,
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
