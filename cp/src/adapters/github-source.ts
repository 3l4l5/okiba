// GitHub の Git Data API で、ツールのディレクトリを丸ごと置き換えるコミットを作る。
// ボット(GitHub App)は Contents の書き込み権限だけを持つ。書き込み先は app/app/tools/<name>/ に限る。
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { UploadFile } from "@okiba/shared";
import { config, requireAws } from "../config";
import type { ReleaseRef, SourceStore, ToolSnapshot } from "./types";

type TreeEntry = { path?: string; type?: string; sha?: string; mode?: string };

export class GithubSourceStore implements SourceStore {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;

  constructor() {
    const aws = requireAws(["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_INSTALLATION_ID", "GITHUB_REPO"]);
    const [owner, repo] = aws.GITHUB_REPO.split("/");
    if (!owner || !repo) throw new Error("GITHUB_REPO は owner/name の形で指定してください");
    this.owner = owner;
    this.repo = repo;
    this.branch = config.GITHUB_MAIN_BRANCH;
    this.octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: aws.GITHUB_APP_ID,
        privateKey: aws.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
        installationId: Number(aws.GITHUB_INSTALLATION_ID),
      },
    });
  }

  private toolPath(name: string): string {
    return `${config.toolsDirInRepo}/${name}`;
  }

  async headSha(): Promise<string> {
    const { data } = await this.octokit.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${this.branch}` });
    return data.object.sha;
  }

  private async treeOfCommit(commitSha: string): Promise<{ treeSha: string; entries: TreeEntry[] }> {
    const { data: commit } = await this.octokit.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: commitSha });
    const { data: tree } = await this.octokit.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: commit.tree.sha,
      recursive: "1",
    });
    return { treeSha: commit.tree.sha, entries: tree.tree as TreeEntry[] };
  }

  private async filesFromEntries(name: string, entries: TreeEntry[]): Promise<UploadFile[]> {
    const prefix = `${this.toolPath(name)}/`;
    const blobs = entries.filter((e) => e.type === "blob" && e.path?.startsWith(prefix) && e.sha);
    const files: UploadFile[] = [];
    for (const entry of blobs) {
      const { data } = await this.octokit.git.getBlob({ owner: this.owner, repo: this.repo, file_sha: entry.sha! });
      files.push({ path: entry.path!.slice(prefix.length), content: data.content.replace(/\n/g, ""), encoding: "base64" });
    }
    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async readTool(name: string): Promise<ToolSnapshot> {
    const head = await this.headSha();
    const { entries } = await this.treeOfCommit(head);
    const dirEntry = entries.find((e) => e.type === "tree" && e.path === this.toolPath(name));
    const files = await this.filesFromEntries(name, entries);
    return { files, baseSha: dirEntry?.sha ?? "empty" };
  }

  async readToolAt(name: string, commitSha: string): Promise<UploadFile[]> {
    const { entries } = await this.treeOfCommit(commitSha);
    return this.filesFromEntries(name, entries);
  }

  /** main の先頭に、ツールのディレクトリを置き換える(または消す)コミットを作る。変更がなければ先頭をそのまま返す */
  private async createCommitOnHead(release: ReleaseRef): Promise<string> {
    if (!release.toolName) throw new Error("toolName がありません");
    const head = await this.headSha();
    const { treeSha, entries } = await this.treeOfCommit(head);
    const prefix = `${this.toolPath(release.toolName)}/`;
    const newFiles = release.op === "remove" ? [] : (release.files ?? []);
    const newPaths = new Set(newFiles.map((f) => `${prefix}${f.path}`));
    const treeItems: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
    for (const entry of entries) {
      if (entry.type === "blob" && entry.path?.startsWith(prefix) && !newPaths.has(entry.path)) {
        treeItems.push({ path: entry.path, mode: "100644", type: "blob", sha: null });
      }
    }
    for (const file of newFiles) {
      const content = file.encoding === "base64" ? file.content : Buffer.from(file.content, "utf8").toString("base64");
      const { data: blob } = await this.octokit.git.createBlob({ owner: this.owner, repo: this.repo, content, encoding: "base64" });
      treeItems.push({ path: `${prefix}${file.path}`, mode: "100644", type: "blob", sha: blob.sha });
    }
    if (treeItems.length === 0) return head;
    const { data: newTree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: treeSha,
      tree: treeItems,
    });
    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: `okiba: ${release.reason} ${release.toolName} (release #${release.id})`,
      tree: newTree.sha,
      parents: [head],
      author: { name: release.createdBy, email: release.createdBy, date: new Date().toISOString() },
    });
    return commit.sha;
  }

  async prepareRelease(release: ReleaseRef): Promise<{ commitSha: string; branch?: string }> {
    if (release.op === "reconcile") return { commitSha: await this.headSha() };
    const commitSha = await this.createCommitOnHead(release);
    const branch = `release/${release.id}`;
    await this.octokit.git.createRef({ owner: this.owner, repo: this.repo, ref: `refs/heads/${branch}`, sha: commitSha });
    return { commitSha, branch };
  }

  private async updateMain(sha: string): Promise<boolean> {
    try {
      await this.octokit.git.updateRef({ owner: this.owner, repo: this.repo, ref: `heads/${this.branch}`, sha, force: false });
      return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) return false;
      throw err;
    }
  }

  async promote(release: ReleaseRef, commitSha: string, branch?: string): Promise<void> {
    if (release.op !== "reconcile") {
      const ok = await this.updateMain(commitSha);
      if (!ok) {
        // main が先に進んでいた。同じ変更を新しい先頭に乗せ直す
        const retried = await this.createCommitOnHead(release);
        if (!(await this.updateMain(retried))) {
          throw new Error("main の更新が 2 回続けて fast-forward できませんでした");
        }
      }
    }
    await this.discard(branch);
  }

  async discard(branch?: string): Promise<void> {
    if (!branch) return;
    try {
      await this.octokit.git.deleteRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404 && status !== 422) throw err;
    }
  }

  async downloadZip(commitSha: string): Promise<Buffer> {
    const res = await this.octokit.repos.downloadZipballArchive({ owner: this.owner, repo: this.repo, ref: commitSha });
    return Buffer.from(res.data as ArrayBuffer);
  }
}
