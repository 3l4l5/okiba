import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>見つかりません</h1>
      <p>
        <Link href="/">一覧に戻る</Link>
      </p>
    </>
  );
}
