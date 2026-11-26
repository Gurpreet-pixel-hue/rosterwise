import { redirect } from "next/navigation";
import { DEMO_MONTH } from "@/lib/config";

export default function RosterIndex() {
  redirect(`/roster/${DEMO_MONTH}`);
}
