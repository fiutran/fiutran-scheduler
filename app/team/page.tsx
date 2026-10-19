import { Ready } from "@/components/Ready";
import { TeamScreen } from "@/components/team/TeamScreen";

export const metadata = { title: "Team · Fiutran Scheduler" };

export default function TeamPage() {
  return (
    <Ready>
      <TeamScreen />
    </Ready>
  );
}
