// 基盤ファイル。一覧は CP が持つので、そちらへ送る。
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect(process.env.OKIBA_CP_URL ?? "http://localhost:3000");
}
