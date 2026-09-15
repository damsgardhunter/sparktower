import { useLocalSearchParams } from "expo-router";
import { ProfileView, type ProfileTabName } from "../../src/components/ProfileView";

/** Your own profile, opened from your photo in the header. `?tab=editor` opens a tab, like the web's `/profile#editor`. */
export default function Profile() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <ProfileView isOwn initialTab={tab as ProfileTabName | undefined} />;
}
