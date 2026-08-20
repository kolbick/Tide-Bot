export const PRODUCT_NAME = 'Tide-Bot Browser Control';
export const DEFAULT_SERVER_ORIGIN =
	typeof __TIDE_BOT_SERVER_ORIGIN__ === 'string'
		? __TIDE_BOT_SERVER_ORIGIN__
		: 'https://tide-bot.com';
export const ACTION_MODES = ['autonomous', 'consequential-approval', 'manual-approval'] as const;
export const TAB_POLICIES = ['locked', 'follow-active'] as const;
export const VOICE_MODES = ['hands-free', 'push-to-talk'] as const;
export const PROTOCOL_VERSION = 1 as const;

declare const __TIDE_BOT_SERVER_ORIGIN__: string;

export type ActionMode = (typeof ACTION_MODES)[number];
export type TabPolicy = (typeof TAB_POLICIES)[number];
export type VoiceMode = (typeof VOICE_MODES)[number];
