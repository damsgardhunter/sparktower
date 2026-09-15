import { useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ProfileView } from "../../src/components/ProfileView";

/** Another builder's public profile. Opening your own id shows your own view. */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState("Profile");
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ProfileView userId={id} onName={setTitle} />
    </>
  );
}
