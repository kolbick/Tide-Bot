export type MainWindowActionDeps = {
	invoke?: (command: string) => Promise<unknown>;
	navigate: (path: string) => void;
	windowRef?: Window;
};

export async function openMainWindow({
	invoke,
	navigate,
	windowRef = typeof window !== 'undefined' ? window : undefined
}: MainWindowActionDeps): Promise<void> {
	if (windowRef && '__TAURI_INTERNALS__' in windowRef && invoke) {
		await invoke('show_main_window');
		return;
	}
	navigate('/');
}
