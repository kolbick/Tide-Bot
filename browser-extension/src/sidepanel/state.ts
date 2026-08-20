export interface PanelMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	parentId: string | null;
	childrenIds: string[];
	model?: string;
	done?: boolean;
	timestamp: number;
}

export interface ActivityItem {
	id: string;
	label: string;
	status: 'running' | 'complete' | 'failed' | 'waiting';
}

export const newId = () => crypto.randomUUID();

export function messagesFromChat(value: unknown): PanelMessage[] {
	if (typeof value !== 'object' || value === null) return [];
	const outer = value as Record<string, any>;
	const chat = outer.chat && typeof outer.chat === 'object' ? outer.chat : outer;
	const history = chat.history;
	if (history?.messages && typeof history.messages === 'object') {
		return Object.values(history.messages)
			.filter(
				(message: any) =>
					message &&
					(message.role === 'user' || message.role === 'assistant') &&
					typeof message.content === 'string'
			)
			.sort((left: any, right: any) => Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0))
			.map((message: any) => ({
				id: String(message.id ?? newId()),
				role: message.role,
				content: message.content,
				parentId: typeof message.parentId === 'string' ? message.parentId : null,
				childrenIds: Array.isArray(message.childrenIds) ? message.childrenIds.map(String) : [],
				model: typeof message.model === 'string' ? message.model : undefined,
				done: message.done !== false,
				timestamp: Number(message.timestamp ?? 0)
			}));
	}
	return Array.isArray(chat.messages)
		? chat.messages
				.filter((message: any) => message?.role === 'user' || message?.role === 'assistant')
				.map((message: any, index: number) => ({
					id: String(message.id ?? newId()),
					role: message.role,
					content: String(message.content ?? ''),
					parentId: index ? String(chat.messages[index - 1]?.id ?? '') || null : null,
					childrenIds: [],
					done: true,
					timestamp: Number(message.timestamp ?? index)
				}))
		: [];
}

export function chatDocument(id: string, model: string, messages: PanelMessage[]) {
	const byId = Object.fromEntries(messages.map((message) => [message.id, { ...message }]));
	return {
		id,
		title: messages.find((message) => message.role === 'user')?.content.slice(0, 80) || 'New Chat',
		models: [model],
		history: { currentId: messages.at(-1)?.id ?? null, messages: byId },
		messages: messages.map(({ role, content }) => ({ role, content })),
		tags: [],
		timestamp: Date.now()
	};
}
