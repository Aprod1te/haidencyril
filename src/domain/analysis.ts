import { z } from 'zod';
import { taskStepSchema } from './task-plan';

export const confidenceSchema = z.enum(['low', 'medium', 'high']);

export const analysisSchema = z.object({
	title: z.string().min(1),
	summary: z.string().min(1),
	recordType: z.enum([
		'idea',
		'observation',
		'problem',
		'feedback',
		'plan',
		'action-result',
		'unknown',
	]),
	facts: z.array(
		z.object({
			statement: z.string().min(1),
			evidence: z.string().min(1),
		}),
	),
	interpretations: z.array(
		z.object({
			statement: z.string().min(1),
			evidence: z.string().min(1),
			confidence: confidenceSchema,
		}),
	),
	unknowns: z.array(z.string().min(1)),
	questions: z.array(z.string().min(1)).max(3),
	nextActions: z.array(taskStepSchema).max(8),
	reflectionComparison: z.object({
		aligned: z.array(z.string().min(1)),
		challenges: z.array(z.string().min(1)),
	}),
	connections: z.array(
		z.object({
			notePath: z.string().min(1),
			relation: z.string().min(1),
			reason: z.string().min(1),
			confidence: confidenceSchema,
		}),
	),
});

export type FragmentAnalysis = z.infer<typeof analysisSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;

export interface UserReflection {
	currentView: string;
	uncertainty: string;
}

export const analysisJsonSchema = (() => {
	const schema = z.toJSONSchema(analysisSchema);
	delete schema.$schema;
	return schema;
})();

const RECORD_TYPE_LABELS: Record<FragmentAnalysis['recordType'], string> = {
	idea: '想法',
	observation: '观察',
	problem: '问题',
	feedback: '反馈',
	plan: '计划',
	'action-result': '行动结果',
	unknown: '暂不确定',
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
	low: '低',
	medium: '中',
	high: '高',
};

function bulletList(items: string[], emptyText: string): string {
	if (items.length === 0) {
		return `- ${emptyText}`;
	}
	return items.join('\n');
}

function wikiLink(path: string): string {
	return `[[${path.replace(/\.md$/u, '')}]]`;
}

export function renderAnalysisMarkdown(
	analysis: FragmentAnalysis,
	reflection: UserReflection,
	sourcePath: string,
	model: string,
	createdAt: string,
): string {
	const facts = analysis.facts.map(
		(item) => `- **${item.statement}**\n  - 依据：${item.evidence}`,
	);
	const interpretations = analysis.interpretations.map(
		(item) =>
			`- **${item.statement}**（置信度：${CONFIDENCE_LABELS[item.confidence]}）\n  - 依据：${item.evidence}`,
	);
	const questions = analysis.questions.map((question) => `- [ ] ${question}`);
	const nextActions = analysis.nextActions.map(
		(item) => `- [ ] ${item.action}\n  - 完成标准：${item.doneWhen}`,
	);
	const unknowns = analysis.unknowns.map((unknown) => `- ${unknown}`);
	const aligned = analysis.reflectionComparison.aligned.map((item) => `- ${item}`);
	const challenges = analysis.reflectionComparison.challenges.map(
		(item) => `- ${item}`,
	);
	const connections = analysis.connections.map(
		(connection) =>
			`- ${wikiLink(connection.notePath)} · ${connection.relation}（置信度：${CONFIDENCE_LABELS[connection.confidence]}）\n  - ${connection.reason}`,
	);

	return `---
haidencyril_type: analysis
haidencyril_created: ${JSON.stringify(createdAt)}
haidencyril_model: ${JSON.stringify(model)}
---

# ${analysis.title}

> [!info] 分析边界
> 这是一份可核对的分析摘要，不是事实裁决，也不是模型的隐藏思维过程。重要判断仍由你完成。

原始碎片：${wikiLink(sourcePath)}

## 你的初步判断

${reflection.currentView}

### 你最不确定的地方

${reflection.uncertainty || '暂时没有单独写下不确定点。'}

## 摘要

${analysis.summary}

记录类型：**${RECORD_TYPE_LABELS[analysis.recordType]}**

## 已知事实

${bulletList(facts, '暂时没有足够信息可以认定为事实。')}

## 解释与假设

${bulletList(interpretations, '暂时没有形成可靠假设。')}

## 尚不清楚

${bulletList(unknowns, '暂时没有额外未知项。')}

## 需要你思考

${bulletList(questions, '当前不需要补充问题。')}

## 可执行任务清单

${bulletList(nextActions, '这条记录目前不需要转成行动。')}

## 与你的判断对照

### 相互支持的地方

${bulletList(aligned, '暂时没有足够信息形成明确呼应。')}

### 值得反驳或继续验证的地方

${bulletList(challenges, '暂时没有发现明显冲突。')}

## 可能的联系

${bulletList(connections, '暂时没有发现足够可信的联系。')}

---

生成时间：${createdAt}  
使用模型：${model}
`;
}
