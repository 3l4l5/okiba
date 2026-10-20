// 環境変数をここで 1 回だけ読む。aws モード専用の値は、aws のアダプタを作るときに requireAws で確かめる。
import path from "node:path";
import { z } from "zod";

const schema = z.object({
  OKIBA_MODE: z.enum(["local", "aws"]).default("local"),
  OKIBA_AUTH_MODE: z.enum(["dev", "alb"]).default("dev"),
  OKIBA_DEV_USER: z.string().default("dev@example.com"),
  OKIBA_ALLOWED_DOMAIN: z.string().optional(),
  OKIBA_ADMINS: z.string().default(""),
  PLATFORM_DATABASE_URL: z.string().default("mysql://okiba_cp:okiba_cp@127.0.0.1:3310/okiba_platform"),
  TOOLS_DATABASE_URL: z.string().default("mysql://okiba_cp:okiba_cp@127.0.0.1:3310/okiba_tools"),
  OKIBA_CP_URL: z.string().default("http://localhost:3000"),
  OKIBA_TOOLS_URL: z.string().default("http://localhost:3001"),
  OKIBA_REPO_ROOT: z.string().optional(),
  OKIBA_TEMPLATES_DIR: z.string().optional(),
  OKIBA_LOCAL_SECRETS_FILE: z.string().optional(),
  OKIBA_MAX_TOOLS_PER_USER: z.coerce.number().int().positive().default(10),
  OKIBA_TOKEN_TTL_HOURS: z.coerce.number().positive().default(24),
  OKIBA_DELETE_GRACE_DAYS: z.coerce.number().positive().default(30),
  OKIBA_SSM_PREFIX: z.string().default("/okiba"),
  AWS_REGION: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  GITHUB_MAIN_BRANCH: z.string().default("main"),
  OKIBA_S3_BUCKET: z.string().optional(),
  OKIBA_CODEBUILD_PROJECT: z.string().optional(),
  OKIBA_ECR_REPO_URI: z.string().optional(),
  OKIBA_APP_LAMBDA_FUNCTION: z.string().optional(),
  OKIBA_APP_LOG_GROUP: z.string().optional(),
});

type Env = z.infer<typeof schema>;

const env: Env = schema.parse(process.env);

const repoRoot = env.OKIBA_REPO_ROOT ? path.resolve(env.OKIBA_REPO_ROOT) : path.resolve(process.cwd(), "..");

export const config = {
  ...env,
  admins: env.OKIBA_ADMINS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  repoRoot,
  templatesDir: env.OKIBA_TEMPLATES_DIR ? path.resolve(env.OKIBA_TEMPLATES_DIR) : path.join(repoRoot, "templates"),
  localSecretsFile: env.OKIBA_LOCAL_SECRETS_FILE
    ? path.resolve(env.OKIBA_LOCAL_SECRETS_FILE)
    : path.join(repoRoot, ".okiba", "secrets.json"),
  localStateDir: path.join(repoRoot, ".okiba"),
  toolsDirInRepo: "app/app/tools",
};

export type AwsKey =
  | "AWS_REGION"
  | "GITHUB_APP_ID"
  | "GITHUB_APP_PRIVATE_KEY"
  | "GITHUB_INSTALLATION_ID"
  | "GITHUB_REPO"
  | "OKIBA_S3_BUCKET"
  | "OKIBA_CODEBUILD_PROJECT"
  | "OKIBA_ECR_REPO_URI"
  | "OKIBA_APP_LAMBDA_FUNCTION"
  | "OKIBA_APP_LOG_GROUP";

/** aws モードで必要な値がそろっているか確かめて返す */
export function requireAws<K extends AwsKey>(keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  const missing: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (!value) missing.push(key);
    else out[key] = value;
  }
  if (missing.length > 0) {
    throw new Error(`環境変数が足りません: ${missing.join(", ")}`);
  }
  return out;
}
