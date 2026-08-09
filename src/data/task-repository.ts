import { App, normalizePath, TFile } from 'obsidian';
import type { TaskListItem } from '../domain/task-plan';
import type { HaidencyrilSettings } from '../settings';

export interface TaskCompletionReflection {
	outcome: string;
	obstacle: string;
	adjustment: string;
}

export interface VaultTask extends TaskListItem {
	id: string;
	file: TFile;
	line: number;
	section: '可执行任务清单' | '下一步行动';
}

export class TaskRepository {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => HaidencyrilSettings,
	) {}

	async getTasks(): Promise<VaultTask[]> {
		const schedulePrefix = `${normalizePath(this.getSettings().scheduleFolder)}/`;
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => !file.path.startsWith('.'))
			.filter((file) => !file.path.startsWith(schedulePrefix));
		const tasks = (
			await Promise.all(
				files.map(async (file) =>
					this.parseTasks(file, await this.app.vault.cachedRead(file)),
				),
			)
		).flat();
		return tasks.sort((left, right) => right.file.stat.mtime - left.file.stat.mtime);
	}

	async readTaskPlan(file: TFile): Promise<TaskListItem[]> {
		return this.parseTasks(file, await this.app.vault.cachedRead(file))
			.filter((task) => task.section === '可执行任务清单')
			.filter((task) => task.doneWhen.length > 0)
			.map(({ action, completed, doneWhen }) => ({
				action,
				completed,
				doneWhen,
			}));
	}

	async saveTaskPlan(file: TFile, tasks: TaskListItem[]): Promise<void> {
		const body = tasks
			.map(
				(task) =>
					`- [${task.completed ? 'x' : ' '}] ${task.action}\n  - 完成标准：${task.doneWhen}`,
			)
			.join('\n');
		await this.app.vault.process(file, (content) => {
			const section = `## 可执行任务清单\n\n${body}`;
			const pattern =
				/^## 可执行任务清单\s*\n[\s\S]*?(?=^##\s|^---\s*$|(?![\s\S]))/mu;
			if (pattern.test(content)) {
				return content.replace(pattern, `${section}\n\n`);
			}
			return `${content.trimEnd()}\n\n${section}\n`;
		});
	}

	async completeWithReflection(
		task: VaultTask,
		reflection: TaskCompletionReflection,
	): Promise<void> {
		const outcome = this.oneLine(reflection.outcome);
		if (!outcome) {
			throw new Error('实际结果不能为空');
		}
		const obstacle = this.oneLine(reflection.obstacle);
		const adjustment = this.oneLine(reflection.adjustment);
		const timestamp = new Intl.DateTimeFormat('zh-CN', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		}).format(new Date());
		const entry = [
			`### ${timestamp} · ${this.oneLine(task.action)}`,
			`- 实际结果：${outcome}`,
			...(obstacle ? [`- 阻碍或偏差：${obstacle}`] : []),
			...(adjustment ? [`- 下次调整：${adjustment}`] : []),
		];

		await this.app.vault.process(task.file, (content) => {
			const lines = content.split('\n');
			const line = this.findTaskLine(lines, task);
			const currentLine = lines[line];
			if (line < 0 || !currentLine) {
				throw new Error('任务已经变化，请刷新工作台后重试');
			}
			lines[line] = currentLine.replace(/^- \[[ xX]\]/u, '- [x]');
			this.appendExecutionEntry(lines, entry);
			return lines.join('\n');
		});
	}

	private parseTasks(file: TFile, content: string): VaultTask[] {
		const lines = content.split('\n');
		const tasks: VaultTask[] = [];
		let section: VaultTask['section'] | null = null;
		for (let index = 0; index < lines.length; index += 1) {
			const heading = lines[index]?.match(/^##\s+(.+?)\s*$/u)?.[1];
			if (heading === '可执行任务清单' || heading === '下一步行动') {
				section = heading;
				continue;
			}
			if (heading) {
				section = null;
				continue;
			}
			if (!section) {
				continue;
			}
			const match = lines[index]?.match(/^- \[([ xX])\]\s+(.+)$/u);
			const action = match?.[2]?.trim();
			if (!action) {
				continue;
			}
			const doneWhen =
				lines[index + 1]?.match(/^\s+- 完成标准：(.+)$/u)?.[1]?.trim() ?? '';
			tasks.push({
				action,
				completed: match?.[1]?.toLowerCase() === 'x',
				doneWhen,
				file,
				id: `${file.path}:${index + 1}`,
				line: index,
				section,
			});
		}
		return tasks;
	}

	private findTaskLine(lines: string[], task: VaultTask): number {
		const currentAction = lines[task.line]
			?.match(/^- \[[ xX]\]\s+(.+)$/u)?.[1]
			?.trim();
		if (currentAction === task.action) {
			return task.line;
		}
		return lines.findIndex(
			(line) =>
				line.match(/^- \[[ xX]\]\s+(.+)$/u)?.[1]?.trim() === task.action,
		);
	}

	private appendExecutionEntry(lines: string[], entry: string[]): void {
		let sectionLine = lines.findIndex((line) => line.trim() === '## 任务执行记录');
		if (sectionLine < 0) {
			if (lines.at(-1)?.trim()) {
				lines.push('');
			}
			lines.push('## 任务执行记录', '', ...entry, '');
			return;
		}
		const nextSection = lines.findIndex(
			(line, index) => index > sectionLine && /^##\s+/u.test(line),
		);
		const insertAt = nextSection < 0 ? lines.length : nextSection;
		lines.splice(insertAt, 0, '', ...entry, '');
	}

	private oneLine(value: string): string {
		return value.trim().replace(/\s*\n+\s*/gu, ' ');
	}
}
