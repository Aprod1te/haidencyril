export interface CalendarBlock {
	title: string;
	start: string;
	end: string;
	location: string;
	kind: 'course' | 'fixed' | 'scheduled-work';
}

export type TaskPriority = 'normal' | 'high';
export type ScheduleDestination = 'calendar' | 'reminder';

export interface ScheduleRequest {
	title: string;
	durationMinutes: number;
	deadline: Date;
	priority: TaskPriority;
}

export interface ScheduleProposal {
	destination: 'calendar';
	title: string;
	start: Date;
	end: Date;
	priority: TaskPriority;
	conflicts: CalendarBlock[];
}

export interface ReminderProposal {
	destination: 'reminder';
	title: string;
	due: Date;
}

export type ActionProposal = ScheduleProposal | ReminderProposal;

export function findScheduleProposal(
	request: ScheduleRequest,
	busyBlocks: CalendarBlock[],
	now = new Date(),
): ScheduleProposal | null {
	const durationMs = request.durationMinutes * 60_000;
	const start = roundToNextHalfHour(now);
	for (
		let cursor = start;
		cursor.getTime() + durationMs <= request.deadline.getTime();
		cursor = new Date(cursor.getTime() + 30 * 60_000)
	) {
		if (!withinWorkingDay(cursor, request.durationMinutes)) {
			continue;
		}
		const end = new Date(cursor.getTime() + durationMs);
		const conflicts = overlappingBlocks(cursor, end, busyBlocks);
		if (conflicts.length === 0) {
			return {
				destination: 'calendar',
				title: request.title,
				start: new Date(cursor),
				end,
				priority: request.priority,
				conflicts: [],
			};
		}
	}

	if (request.priority !== 'high') {
		return null;
	}
	for (
		let cursor = start;
		cursor.getTime() + durationMs <= request.deadline.getTime();
		cursor = new Date(cursor.getTime() + 30 * 60_000)
	) {
		if (!withinWorkingDay(cursor, request.durationMinutes)) {
			continue;
		}
		const end = new Date(cursor.getTime() + durationMs);
		return {
			destination: 'calendar',
			title: request.title,
			start: new Date(cursor),
			end,
			priority: request.priority,
			conflicts: overlappingBlocks(cursor, end, busyBlocks),
		};
	}
	return null;
}

function roundToNextHalfHour(value: Date): Date {
	const rounded = new Date(value);
	rounded.setSeconds(0, 0);
	const minutes = rounded.getMinutes();
	rounded.setMinutes(minutes < 30 ? 30 : 60);
	return rounded;
}

function withinWorkingDay(start: Date, durationMinutes: number): boolean {
	const hour = start.getHours();
	if (hour < 8 || hour >= 22) {
		return false;
	}
	const end = new Date(start.getTime() + durationMinutes * 60_000);
	const endMinutes = end.getHours() * 60 + end.getMinutes();
	return start.toDateString() === end.toDateString() && endMinutes <= 22 * 60;
}

function overlappingBlocks(
	start: Date,
	end: Date,
	blocks: CalendarBlock[],
): CalendarBlock[] {
	return blocks.filter((block) => {
		const blockStart = new Date(block.start);
		const blockEnd = new Date(block.end);
		return start < blockEnd && end > blockStart;
	});
}
