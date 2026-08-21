import { redirect } from "next/navigation";

/** Auth is temporarily disabled — go straight to the dashboard. */
export default function Home() {
  redirect("/dashboard");
}
