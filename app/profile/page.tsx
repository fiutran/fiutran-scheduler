import { Ready } from "@/components/Ready";
import { ProfileScreen } from "@/components/profile/ProfileScreen";

export const metadata = { title: "My profile · Fiutran Scheduler" };

export default function ProfilePage() {
  return (
    <Ready>
      <ProfileScreen />
    </Ready>
  );
}
