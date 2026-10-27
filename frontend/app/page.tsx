import ProtectedDashboard from "@/features/dashboard/components/ProtectedDashboard/ProtectedDashboard";
import Monitors from "@/features/monitors/components/Monitors/Monitors";

export default function HomePage() {
  return <ProtectedDashboard><Monitors /></ProtectedDashboard>;
}
