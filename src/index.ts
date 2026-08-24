import fs from "fs";
import dotenv from "dotenv";
import * as core from "@actions/core";
import axios, { isAxiosError } from "axios";
import { validateCli } from "@1password/op-js";
import { installCliOnGithubActionRunner } from "./op-cli-installer";
import {
	getWorkloadIdentityConfig,
	hasCliAuth,
	loadSecrets,
	unsetPrevious,
	validateAuth,
} from "./utils";
import { loadSecretsFromSDK } from "./sdk-client";
import { envFilePath } from "./constants";

interface GitHubEventData {
	repository?: {
		private?: boolean;
	};
}

const validateSubscription = async () => {
	const eventPath = process.env.GITHUB_EVENT_PATH;
	let repoPrivate: boolean | undefined;

	if (eventPath && fs.existsSync(eventPath)) {
		const eventData = JSON.parse(
			fs.readFileSync(eventPath, "utf8"),
		) as GitHubEventData;
		repoPrivate = eventData?.repository?.private;
	}

	const upstream = "1password/load-secrets-action";
	const action = process.env.GITHUB_ACTION_REPOSITORY;
	const docsUrl =
		"https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";

	core.info("");
	core.info("\u001b[1;36mStepSecurity Maintained Action\u001b[0m");
	core.info(`Secure drop-in replacement for ${upstream}`);
	if (repoPrivate === false) {
		core.info("\u001b[32m✓ Free for public repositories\u001b[0m");
	}
	core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
	core.info("");

	if (repoPrivate === false) {
		return;
	}

	const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
	const body: Record<string, string> = { action: action || "" };
	if (serverUrl !== "https://github.com") {
		body.ghes_server = serverUrl;
	}
	try {
		await axios.post(
			`https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
			body,
			{ timeout: 3000 },
		);
	} catch (error) {
		if (isAxiosError(error) && error.response?.status === 403) {
			core.error(
				`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
			);
			core.error(
				`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`,
			);
			process.exit(1);
		}
		core.info("Timeout or API not reachable. Continuing to next step.");
	}
};

const loadSecretsAction = async () => {
	try {
		await validateSubscription();
		// Get action inputs
		const shouldUnsetPrevious = core.getBooleanInput("unset-previous");
		const shouldExportEnv = core.getBooleanInput("export-env");

		// Unset all secrets managed by 1Password if `unset-previous` is set.
		if (shouldUnsetPrevious) {
			unsetPrevious();
		}

		const workloadConfig = getWorkloadIdentityConfig();

		// `unset-previous` can run with no credentials present: Workload Identity creds
		// are inline per-step and intentionally not persisted (persisting them would make
		// every later step re-load all variables). Nothing to auth or load, we're done.
		if (shouldUnsetPrevious && !workloadConfig && !hasCliAuth()) {
			core.info(
				"No authentication configured; unset previously managed variables. No secrets were loaded.",
			);
			return;
		}

		if (workloadConfig) {
			await loadSecretsFromSDK(
				workloadConfig.workloadId,
				workloadConfig.environmentId,
				workloadConfig.integrationKey,
				shouldExportEnv,
			);
		} else {
			// Validate that a proper authentication configuration is set for the CLI
			validateAuth();

			// Set environment variables from OP_ENV_FILE
			const file = process.env[envFilePath];
			if (file) {
				core.info(`Loading environment variables from file: ${file}`);
				dotenv.config({ path: file });
			}

			// Download and install the CLI
			await installCLI();

			// Load secrets
			await loadSecrets(shouldExportEnv);
		}
	} catch (error) {
		// It's possible for the Error constructor to be modified to be anything
		// in JavaScript, so the following code accounts for this possibility.
		// https://kentcdodds.com/blog/get-a-catch-block-error-message-with-typescript
		let message = "Unknown Error";
		if (error instanceof Error) {
			message = error.message;
		} else {
			String(error);
		}
		core.setFailed(message);
	}
};

// This function's name is an exception from the naming convention
// since we refer to the 1Password CLI here.
// eslint-disable-next-line @typescript-eslint/naming-convention
const installCLI = async (): Promise<void> => {
	// validateCli checks if there's an existing 1Password CLI installed on the runner.
	// If there's no CLI installed, then validateCli will throw an error, which we will use
	// as an indicator that we need to execute the installation script.
	await validateCli().catch(async () => {
		await installCliOnGithubActionRunner();
	});
};

void loadSecretsAction();
