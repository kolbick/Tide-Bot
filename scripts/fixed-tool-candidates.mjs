const posixComposePluginCandidates = [
	'/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
	'/usr/local/lib/docker/cli-plugins/docker-compose',
	'/usr/lib/docker/cli-plugins/docker-compose',
	'/usr/libexec/docker/cli-plugins/docker-compose'
];

const dockerCliCandidatesByPlatform = {
	win32: ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'],
	darwin: ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker'],
	linux: ['/usr/local/bin/docker', '/usr/bin/docker']
};

export function composePluginCandidates(platform = process.platform) {
	return platform === 'win32'
		? ['C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe']
		: [...posixComposePluginCandidates];
}

export function nullDevice(platform = process.platform) {
	return platform === 'win32' ? 'NUL' : '/dev/null';
}

export function dockerCliCandidates(platform = process.platform) {
	return [...(dockerCliCandidatesByPlatform[platform] ?? dockerCliCandidatesByPlatform.linux)];
}

export async function findDockerCliExecutable(platform, accessFile) {
	for (const candidate of dockerCliCandidates(platform)) {
		try {
			await accessFile(candidate);
			return candidate;
		} catch {
			// Continue through approved fixed locations only.
		}
	}
	throw new Error('Docker CLI was not found in an approved fixed location');
}

export function composeInvocation(platform, plugin, dockerCli, args) {
	return platform === 'win32'
		? { file: plugin, args: [...args] }
		: { file: dockerCli, args: ['compose', ...args] };
}
