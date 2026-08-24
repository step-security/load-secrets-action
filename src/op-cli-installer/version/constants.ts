export enum ReleaseChannel {
	latest = "latest",
	latestBeta = "latest-beta",
}

export interface VersionResponse {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	CLI2?: {
		release?: { version?: string };
		beta?: { version?: string };
	};
}

export interface DockerHubTagsResponse {
	results?: { name: string }[];
}
