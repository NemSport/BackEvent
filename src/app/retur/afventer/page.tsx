import { redirect } from "next/navigation";

export default function PendingReturnsPage() {
  redirect("/retur?status=control");
}
