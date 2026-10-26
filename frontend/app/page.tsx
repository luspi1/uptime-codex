import ProtectedDashboard from "./ProtectedDashboard";
import Monitors from "./Monitors";

export default function HomePage() {
  return <ProtectedDashboard><Monitors /></ProtectedDashboard>;
}
