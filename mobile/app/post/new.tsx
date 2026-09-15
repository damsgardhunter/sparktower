import { useLocalSearchParams, useRouter } from "expo-router";
import { PostComposer } from "../../src/components/Composer";

/**
 * Writing a post, full screen. `?type=looking_for_help` opens it on that kind
 * of post and `?projectId=` posts for that project — how the feed's quick
 * buttons and a project's "Post an update" land here ready to write.
 */
export default function NewPost() {
  const router = useRouter();
  const { type, projectId } = useLocalSearchParams<{ type?: string; projectId?: string }>();
  const done = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"));
  return <PostComposer chrome="screen" defaultType={type} defaultProjectId={projectId} onClose={done} onPosted={done} />;
}
