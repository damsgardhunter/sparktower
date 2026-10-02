/**
 * The offer to turn notifications on, on the one screen where it makes sense.
 *
 * iOS allows the permission dialog to be shown *once*. A "no" is permanent
 * until somebody goes into Settings and finds the switch, which nobody does —
 * so where this is asked matters more than how it looks. It is asked here, on
 * the Notifications tab, where the person is looking at a list of things they
 * were told about while the app was open and can see exactly what they would
 * otherwise have missed. It is not asked on launch, or after signing up, or
 * anywhere else.
 *
 * It renders nothing at all in the two cases where there is nothing to offer:
 * permission already granted, and a simulator with no push service behind it.
 */
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Btn, Icon } from "./ui";
import { MenuRow } from "./MoreKit";
import { api, readPref, writePref } from "../api/client";
import { askForPush, openPushSettings, pushPermission, type PushPermission } from "../push";

/** Set when somebody closes the card, so the offer is made once and not nagged. */
const DISMISSED_KEY = "push.offer.dismissed";

export function PushOffer() {
  const [state, setState] = useState<PushPermission | null>(null);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  /*
   * Re-read on focus rather than once on mount: the way back from a refusal is
   * the OS settings app, and somebody who goes there and flips the switch
   * returns to this screen expecting the card to be gone.
   */
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const [permission, seen] = await Promise.all([pushPermission(), readPref(DISMISSED_KEY)]);
        if (!live) return;
        setState(permission);
        setDismissed(seen === "1");
      })();
      return () => { live = false; };
    }, []),
  );

  if (state === null || dismissed === null) return null;
  if (state === "granted" || state === "unsupported") return null;
  if (state === "undetermined" && dismissed) return null;

  const refused = state === "denied";

  const close = () => {
    setDismissed(true);
    void writePref(DISMISSED_KEY, "1");
  };

  return (
    <View style={{
      marginHorizontal: spacing.md, marginBottom: spacing.md, padding: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="notifications" size={18} color={colors.primary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          {refused ? "Notifications are switched off" : "Know when somebody's waiting on you"}
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs, lineHeight: 20 }}>
        {refused
          /*
           * Says where the switch is, because this is the only way back and an
           * app cannot re-ask. "Settings" alone sends people to the wrong one.
           */
          ? "Your phone is blocking them for SparkTower. You can turn them back on in your phone's settings for this app."
          : "A reply, an invitation, a decision on your backing, a teammate blocked on your seat. We'll leave the rest in here."}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
        <Btn
          label={refused ? "Open settings" : "Turn them on"}
          small
          onPress={() => {
            if (refused) return void openPushSettings();
            void askForPush().then(setState);
          }}
          testID="push-offer-accept"
        />
        <Btn label="Not now" small variant="ghost" onPress={close} testID="push-offer-dismiss" />
      </View>
    </View>
  );
}

/**
 * The switch, in Settings: push on or off for this person, on every device.
 *
 * Two different switches exist and conflating them would be a trap. The OS one
 * is per-install, awkward to reverse, and the only thing that can grant
 * permission. This one is a column on the account — it goes quiet without
 * giving up the permission, and it survives a reinstall. Somebody who wants a
 * quiet week wants this one.
 *
 * When the OS switch is off, this row says so instead of offering a control
 * that would change nothing a person could notice.
 */
export function PushSettingsRow() {
  const qc = useQueryClient();
  const [permission, setPermission] = useState<PushPermission | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void pushPermission().then((p) => { if (live) setPermission(p); });
      return () => { live = false; };
    }, []),
  );

  const state = useQuery<{ enabled: boolean; devices: unknown[] }>({
    queryKey: ["push", "state"],
    queryFn: () => api<{ enabled: boolean; devices: unknown[] }>("/api/push/state"),
  });

  const set = useMutation({
    mutationFn: (enabled: boolean) => api("/api/push/state", { method: "PATCH", body: { enabled } }),
    /* Optimistic would be wrong here: a failed write must not look like a quiet phone. */
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["push", "state"] }),
  });

  const enabled = state.data?.enabled ?? true;
  const blocked = permission === "denied";
  const devices = state.data?.devices?.length ?? 0;

  return (
    <MenuRow
      icon="notifications"
      title="Push notifications"
      subtitle={
        blocked
          ? "Blocked in your phone's settings for SparkTower"
          : !enabled
            ? "Off — everything still arrives in your notifications here"
            : devices === 1
              ? "On, for this device"
              : devices > 1
                ? `On, for ${devices} devices`
                : "On — turn them on for this device from the Notifications tab"
      }
      tint={enabled && !blocked ? colors.primary : colors.textSecondary}
      onPress={blocked ? () => void openPushSettings() : undefined}
      right={
        blocked ? undefined : (
          <Switch
            value={enabled}
            onValueChange={(next) => set.mutate(next)}
            disabled={state.isLoading || set.isPending}
            trackColor={{ true: colors.primary, false: colors.border }}
            testID="settings-push-switch"
          />
        )
      }
      testID="settings-push"
    />
  );
}
