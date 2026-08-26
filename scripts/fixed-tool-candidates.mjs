const posixComposePluginCandidates = [
	'/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
	'/usr/local/lib/docker/cli-plugins/docker-compose',
	'/usr/lib/docker/cli-plugins/docker-compose'
];

export function composePluginCandidates(platform = process.platform) {
	return platform === 'win32'
		? ['C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe']
		: [...posixComposePluginCandidates];
}

export function pythonCandidates(platform = process.platform, environment = process.env) {
	const configured = environment.PYTHON_BIN ? [environment.PYTHON_BIN] : [];
	return platform === 'win32'
		? [...configured, 'python']
		: [
				'/tmp/yaml-venv/bin/python',
				...configured,
				'/usr/local/bin/python3.12',
				'/usr/bin/python3',
				'python3'
			];
}

export function nullDevice(platform = process.platform) {
	return platform === 'win32' ? 'NUL' : '/dev/null';
}

export function dockerCliExecutable(platform = process.platform) {
	return platform === 'win32'
		? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
		: 'docker';
}

export function composeInvocation(platform, plugin, args) {
	return platform === 'win32'
		? { file: plugin, args: [...args] }
		: { file: 'docker', args: ['compose', ...args] };
}
