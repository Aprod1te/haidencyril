import ICAL from 'ical.js';
import type { CalendarBlock } from '../domain/schedule';

export class IcsCourseImportService {
	parse(content: string, now = new Date()): CalendarBlock[] {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- ical.js exposes parsed jCal as `any` in its public types.
		const root = new ICAL.Component(ICAL.parse(content));
		const calendarEnd = new Date(now);
		calendarEnd.setDate(calendarEnd.getDate() + 220);
		const calendarStart = new Date(now);
		calendarStart.setDate(calendarStart.getDate() - 14);
		const blocks: CalendarBlock[] = [];

		for (const component of root.getAllSubcomponents('vevent')) {
			const event = new ICAL.Event(component);
			if (event.isRecurrenceException()) {
				continue;
			}
			if (event.isRecurring()) {
				const iterator = event.iterator(ICAL.Time.fromJSDate(calendarStart));
				for (let count = 0; count < 1000; count += 1) {
					const occurrence = iterator.next();
					if (!occurrence) {
						break;
					}
					const details = event.getOccurrenceDetails(occurrence);
					const start = details.startDate.toJSDate();
					if (start > calendarEnd) {
						break;
					}
					if (start >= calendarStart) {
						blocks.push(
							this.block(event.summary, start, details.endDate.toJSDate(), event.location),
						);
					}
				}
			} else {
				const start = event.startDate.toJSDate();
				if (start >= calendarStart && start <= calendarEnd) {
					blocks.push(
						this.block(event.summary, start, event.endDate.toJSDate(), event.location),
					);
				}
			}
		}

		const unique = new Map<string, CalendarBlock>();
		for (const block of blocks) {
			unique.set(`${block.title}\u0000${block.start}\u0000${block.end}`, block);
		}
		return [...unique.values()].sort(
			(left, right) =>
				new Date(left.start).getTime() - new Date(right.start).getTime(),
		);
	}

	private block(
		title: string,
		start: Date,
		end: Date,
		location: string,
	): CalendarBlock {
		return {
			title: title.trim() || '未命名课程',
			start: start.toISOString(),
			end: end.toISOString(),
			location: location.trim(),
			kind: 'course',
		};
	}
}
