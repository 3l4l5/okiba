// 基盤ファイル。/tools/<name> の共通レイアウト。ツールのコードは import しない。
import ToolHeader from "@/components/ToolHeader";

export const dynamic = "force-dynamic";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ToolHeader />
      <main>{children}</main>
    </>
  );
}
