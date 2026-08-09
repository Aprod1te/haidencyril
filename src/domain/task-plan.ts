import { z } from 'zod';

export const taskStepSchema = z.object({
	action: z.string().min(1),
	doneWhen: z.string().min(1),
});

export const taskPlanSchema = z.object({
	goal: z.string().min(1),
	questions: z.array(z.string().min(1)).max(3),
	tasks: z.array(taskStepSchema).min(1).max(8),
});

export type TaskStep = z.infer<typeof taskStepSchema>;
export type TaskListItem = TaskStep & { completed?: boolean };
export type TaskPlan = z.infer<typeof taskPlanSchema>;

export const taskPlanJsonSchema = (() => {
	const schema = z.toJSONSchema(taskPlanSchema);
	delete schema.$schema;
	return schema;
})();
