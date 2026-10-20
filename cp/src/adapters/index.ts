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
    bundles: new local.NoopBundleStore(),
    builder: new local.NoopBuilder(),
    deployer: new local.NoopDeployer(),
    toolFiles: new local.LocalToolFiles(),
    secrets: new local.LocalSecretStore(),
    dumps: new local.LocalDumpStore(),
    logs: new local.LocalLogReader(),
  };
}

function createAwsAdapters(): Adapters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const aws = require("./aws") as typeof import("./aws");
  return {
    bundles: new aws.S3BundleStore(),
    builder: new aws.CodeBuildBuilder(),
    deployer: new aws.LambdaDeployer(),
    toolFiles: new aws.NoopToolFiles(),
    secrets: new aws.SsmSecretStore(),
    dumps: new aws.S3DumpStore(),
    logs: new aws.CloudWatchLogReader(),
  };
}

export type { Adapters, Builder, BundleStore, Deployer, DumpStore, LogReader, ReleaseRef, SecretStore, ToolFiles } from "./types";
