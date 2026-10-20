import { config } from "../config";
import type { Adapters } from "./types";

const globalRef = globalThis as unknown as { __okibaAdapters?: Adapters };

export function getAdapters(): Adapters {
  if (!globalRef.__okibaAdapters) {
    globalRef.__okibaAdapters = config.OKIBA_MODE === "aws" ? createAwsAdapters() : createLocalAdapters();
  }
  return globalRef.__okibaAdapters;
}

function createLocalAdapters(): Adapters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const local = require("./local") as typeof import("./local");
  return {
    source: new local.LocalSourceStore(),
    builder: new local.NoopBuilder(),
    deployer: new local.NoopDeployer(),
    secrets: new local.LocalSecretStore(),
    dumps: new local.LocalDumpStore(),
    logs: new local.LocalLogReader(),
  };
}

function createAwsAdapters(): Adapters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const aws = require("./aws") as typeof import("./aws");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const github = require("./github-source") as typeof import("./github-source");
  const source = new github.GithubSourceStore();
  return {
    source,
    builder: new aws.CodeBuildBuilder(source),
    deployer: new aws.LambdaDeployer(),
    secrets: new aws.SsmSecretStore(),
    dumps: new aws.S3DumpStore(),
    logs: new aws.CloudWatchLogReader(),
  };
}

export type { Adapters, Builder, Deployer, DumpStore, LogReader, ReleaseRef, SecretStore, SourceStore } from "./types";
