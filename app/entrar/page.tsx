import { AccountScreen } from "@/components/AccountScreen";
export const dynamic = "force-dynamic";
export default function Page() {
  return <AccountScreen mode="login" google={!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />;
}
