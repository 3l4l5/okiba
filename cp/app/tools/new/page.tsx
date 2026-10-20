import { NewToolForm } from "./NewToolForm";

export const dynamic = "force-dynamic";

export default function NewToolPage() {
  return (
    <>
      <h1>新しいツール</h1>
      <div className="card">
        <NewToolForm />
      </div>
    </>
  );
}
