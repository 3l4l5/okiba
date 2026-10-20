// aws モードのアダプタ。CodeBuild でビルド、Lambda にデプロイ、Parameter Store に認証情報、S3 にダンプ、CloudWatch Logs を読む。
import { CloudWatchLogsClient, FilterLogEventsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { BatchGetBuildsCommand, CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { GetFunctionConfigurationCommand, LambdaClient, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DeleteParameterCommand,
  DeleteParametersCommand,
  GetParametersByPathCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { config, requireAws } from "../config";
import type { BuildStatus, Builder, Deployer, DumpStore, LogReader, ReleaseRef, SecretStore, SourceStore } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CodeBuildBuilder implements Builder {
  private readonly codebuild: CodeBuildClient;
  private readonly s3: S3Client;
  private readonly logs: CloudWatchLogsClient;
  private readonly bucket: string;
  private readonly project: string;
  private readonly ecrRepoUri: string;

  constructor(private readonly source: SourceStore) {
    const aws = requireAws(["AWS_REGION", "OKIBA_S3_BUCKET", "OKIBA_CODEBUILD_PROJECT", "OKIBA_ECR_REPO_URI"]);
    this.codebuild = new CodeBuildClient({ region: aws.AWS_REGION });
    this.s3 = new S3Client({ region: aws.AWS_REGION });
    this.logs = new CloudWatchLogsClient({ region: aws.AWS_REGION });
    this.bucket = aws.OKIBA_S3_BUCKET;
    this.project = aws.OKIBA_CODEBUILD_PROJECT;
    this.ecrRepoUri = aws.OKIBA_ECR_REPO_URI;
  }

  async start(release: ReleaseRef, commitSha: string): Promise<{ buildId: string }> {
    const zip = await this.source.downloadZip(commitSha);
    const key = `sources/${release.id}.zip`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: zip, ContentType: "application/zip" }));
    const res = await this.codebuild.send(
      new StartBuildCommand({
        projectName: this.project,
        sourceTypeOverride: "S3",
        sourceLocationOverride: `${this.bucket}/${key}`,
        environmentVariablesOverride: [
          { name: "ECR_REPO_URI", value: this.ecrRepoUri, type: "PLAINTEXT" },
          { name: "IMAGE_TAG", value: commitSha, type: "PLAINTEXT" },
        ],
      }),
    );
    if (!res.build?.id) throw new Error("CodeBuild の開始に失敗しました");
    return { buildId: res.build.id };
  }

  async status(buildId: string): Promise<BuildStatus> {
    const res = await this.codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const build = res.builds?.[0];
    if (!build) return { state: "failed", logTail: `ビルド ${buildId} が見つかりません` };
    const logUrl = build.logs?.deepLink;
    if (build.buildStatus === "IN_PROGRESS") return { state: "running", logUrl };
    if (build.buildStatus === "SUCCEEDED") {
      const tag = build.environment?.environmentVariables?.find((v) => v.name === "IMAGE_TAG")?.value;
      return { state: "succeeded", imageUri: `${this.ecrRepoUri}:${tag ?? "latest"}`, logUrl };
    }
    return { state: "failed", logUrl, logTail: await this.logTail(build.logs?.groupName, build.logs?.streamName) };
  }

  private async logTail(groupName?: string, streamName?: string): Promise<string> {
    if (!groupName || !streamName) return "";
    try {
      const res = await this.logs.send(
        new GetLogEventsCommand({ logGroupName: groupName, logStreamName: streamName, limit: 200, startFromHead: false }),
      );
      return (res.events ?? []).map((e) => e.message ?? "").join("");
    } catch (err) {
      return `ビルドログを取得できませんでした: ${(err as Error).message}`;
    }
  }
}

export class LambdaDeployer implements Deployer {
  private readonly lambda: LambdaClient;
  private readonly functionName: string;

  constructor() {
    const aws = requireAws(["AWS_REGION", "OKIBA_APP_LAMBDA_FUNCTION"]);
    this.lambda = new LambdaClient({ region: aws.AWS_REGION });
    this.functionName = aws.OKIBA_APP_LAMBDA_FUNCTION;
  }

  async deploy(imageUri: string): Promise<void> {
    await this.lambda.send(new UpdateFunctionCodeCommand({ FunctionName: this.functionName, ImageUri: imageUri }));
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await sleep(3000);
      const res = await this.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: this.functionName }));
      if (res.LastUpdateStatus === "Successful") return;
      if (res.LastUpdateStatus === "Failed") {
        throw new Error(`Lambda の更新に失敗しました: ${res.LastUpdateStatusReason ?? ""}`);
      }
    }
    throw new Error("Lambda の更新がタイムアウトしました");
  }
}

export class SsmSecretStore implements SecretStore {
  private readonly ssm: SSMClient;
  private readonly prefix: string;

  constructor() {
    const aws = requireAws(["AWS_REGION"]);
    this.ssm = new SSMClient({ region: aws.AWS_REGION });
    this.prefix = config.OKIBA_SSM_PREFIX.replace(/\/$/, "");
  }

  private toolPath(toolName: string): string {
    return `${this.prefix}/tools/${toolName}/`;
  }

  private async namesUnder(pathPrefix: string, recursive: boolean): Promise<string[]> {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.ssm.send(
        new GetParametersByPathCommand({ Path: pathPrefix, Recursive: recursive, WithDecryption: false, NextToken: token }),
      );
      for (const p of res.Parameters ?? []) if (p.Name) names.push(p.Name);
      token = res.NextToken;
    } while (token);
    return names;
  }

  async list(toolName: string): Promise<string[]> {
    const base = this.toolPath(toolName);
    return (await this.namesUnder(base, false)).map((n) => n.slice(base.length)).sort();
  }

  async put(toolName: string, key: string, value: string): Promise<void> {
    const name = `${this.toolPath(toolName)}${key}`;
    try {
      await this.ssm.send(
        new PutParameterCommand({
          Name: name,
          Value: value,
          Type: "SecureString",
          Tags: [{ Key: "okiba:tool", Value: toolName }],
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "ParameterAlreadyExists") throw err;
      await this.ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: "SecureString", Overwrite: true }));
    }
  }

  async delete(toolName: string, key: string): Promise<void> {
    try {
      await this.ssm.send(new DeleteParameterCommand({ Name: `${this.toolPath(toolName)}${key}` }));
    } catch (err) {
      if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
    }
  }

  async deleteAll(toolName: string): Promise<void> {
    const names = await this.namesUnder(this.toolPath(toolName), true);
    for (let i = 0; i < names.length; i += 10) {
      await this.ssm.send(new DeleteParametersCommand({ Names: names.slice(i, i + 10) }));
    }
  }

  async listToolNames(): Promise<string[]> {
    const base = `${this.prefix}/tools/`;
    const names = await this.namesUnder(base, true);
    return [...new Set(names.map((n) => n.slice(base.length).split("/")[0]).filter(Boolean))].sort();
  }
}

export class S3DumpStore implements DumpStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    const aws = requireAws(["AWS_REGION", "OKIBA_S3_BUCKET"]);
    this.s3 = new S3Client({ region: aws.AWS_REGION });
    this.bucket = aws.OKIBA_S3_BUCKET;
  }

  async putDump(toolName: string, releaseId: number | "delete", sql: string): Promise<{ url: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `dumps/${toolName}/${stamp}-${releaseId}.sql`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: sql, ContentType: "application/sql" }));
    return { url: `s3://${this.bucket}/${key}` };
  }
}

export class CloudWatchLogReader implements LogReader {
  private readonly logs: CloudWatchLogsClient;
  private readonly group: string;

  constructor() {
    const aws = requireAws(["AWS_REGION", "OKIBA_APP_LOG_GROUP"]);
    this.logs = new CloudWatchLogsClient({ region: aws.AWS_REGION });
    this.group = aws.OKIBA_APP_LOG_GROUP;
  }

  async tail(toolName: string, limit: number): Promise<string[]> {
    const res = await this.logs.send(
      new FilterLogEventsCommand({
        logGroupName: this.group,
        filterPattern: `{ $.tool = "${toolName}" }`,
        startTime: Date.now() - 60 * 60 * 1000,
        limit,
      }),
    );
    return (res.events ?? []).map((e) => `${new Date(e.timestamp ?? 0).toISOString()} ${e.message ?? ""}`.trimEnd());
  }
}
