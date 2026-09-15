import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { spacing } from "../../src/theme";
import { Empty, Loading, Screen } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { InvitationRow, NetworkBlock, networkStyles } from "../../src/components/NetworkCards";
import { personAvatar, personName, useConnectionRequests, useInvitationActions } from "../../src/networkData";

/**
 * Every connection request waiting on you, with the note that came with it.
 * Accepting opens messaging between you; ignoring is quiet — they aren't told.
 */
export default function Invitations() {
  const router = useRouter();
  const requests = useConnectionRequests();
  const { notice, show, clear } = useNotice();
  const invites = useInvitationActions(show);
  const rows = requests.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Invitations" }} />
      <Screen canvas onRefresh={requests.refetch} refreshing={requests.isRefetching} contentStyle={{ padding: 0, gap: spacing.sm }}>
        {requests.isLoading ? <Loading /> : (
          <NetworkBlock title={`Received (${rows.length})`} subtitle="People who'd like to connect with you" flush>
            {!rows.length ? (
              <Empty icon="mail-open-outline" title="No pending invitations" body="When someone asks to connect, it shows up here with their note." />
            ) : rows.map((r, i) => {
              const name = personName(r.user, r.profile);
              return (
                <View key={r.id}>
                  {i > 0 && <View style={networkStyles.divider} />}
                  <InvitationRow
                    name={name}
                    headline={r.profile?.headline}
                    avatarUrl={personAvatar(r.user, r.profile)}
                    note={r.note}
                    createdAt={r.createdAt}
                    busy={invites.busyId === r.id}
                    onOpen={() => router.push(`/user/${r.requesterId}`)}
                    onAccept={() => invites.accept({ id: r.id, name })}
                    onIgnore={() => invites.ignore({ id: r.id, name })}
                  />
                </View>
              );
            })}
          </NetworkBlock>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
