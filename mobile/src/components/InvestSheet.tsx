/**
 * "Invest in this project" — the founder's ask, and applying to talk.
 *
 * The native counterpart of client/src/components/invest-card.tsx, against the
 * same endpoints. Renders nothing when applications are closed, except to the
 * owner, who's pointed at the project manager where they open them.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Body, Btn, Chip, ErrorNote, Field, Icon, Meta, Row, errText } from "./ui";
import { Block } from "./ProjectBits";
import { CheckRow, ChoicePills, FormGroup, ProjectFormSheet } from "./ProjectFormSheet";
import {
  ACCREDITED_ANSWERS, INVESTMENT_AMOUNTS, INVESTMENT_INSTRUMENTS, INVESTMENT_MESSAGE_MAX, INVESTMENT_STATUS_LABEL,
  INVESTOR_TYPES, labelOf, type InvestmentStatus,
} from "../projectData";
import type { Notice } from "./Sheet";

interface InvestmentInfo {
  open: boolean;
  ask: { headline: string; amount: string | null; minimum: string | null; instruments: string[]; useOfFunds: string } | null;
  isOwner: boolean;
  mine: { id: string; status: InvestmentStatus; createdAt: string } | null;
  disclaimer: string;
}

const EMPTY = { amount: "", instrument: "", investorType: "", accredited: "", message: "", phone: "", linkedinUrl: "", consent: false };

export function InvestCard({ projectId, notify }: { projectId: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["project", projectId, "investment"];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: key, queryFn: () => api<InvestmentInfo>(`/api/projects/${projectId}/investment`), retry: false });

  const apply = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/investment/applications`, { method: "POST", body: form }),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
      notify({ text: "Application sent. The founder will review it and reach out if it's a fit.", tone: "success" });
    },
    onError: (e) => setError(errText(e, "Couldn't send that.")),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/api/investment-applications/${id}`, { method: "PATCH", body: { status: "withdrawn" } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); notify({ text: "Application withdrawn.", tone: "info" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't withdraw."), tone: "error" }),
  });

  if (!data) return null;

  if (!data.open) {
    if (!data.isOwner) return null;
    return (
      <Block title="Investment applications are off" icon="cash-outline">
        <Body muted>Open them and anyone who finds this page can apply to invest. You review every application first.</Body>
        <Btn label="Set up applications" variant="outline" small icon="settings-outline" style={{ alignSelf: "flex-start" }}
          onPress={() => router.push(`/manage/${projectId}?tab=investors` as any)} />
      </Block>
    );
  }

  const ask = data.ask;
  const active = data.mine && data.mine.status !== "withdrawn" && data.mine.status !== "declined";
  const ready = !!(form.amount && form.instrument && form.investorType && form.accredited && form.message.trim().length >= 20 && form.consent);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <Block title="Invest in this project" icon="cash-outline">
        {ask?.headline ? <Body muted>{ask.headline}</Body> : null}
        {(ask?.amount || ask?.minimum) && (
          <Row gap={spacing.sm}>
            {ask?.amount && <Stat label="Raising" value={labelOf(INVESTMENT_AMOUNTS, ask.amount)} />}
            {ask?.minimum && <Stat label="Smallest check" value={labelOf(INVESTMENT_AMOUNTS, ask.minimum)} />}
          </Row>
        )}
        {!!ask?.instruments?.length && (
          <Row wrap gap={spacing.xs}>
            {ask.instruments.map((i) => <Chip key={i} small label={labelOf(INVESTMENT_INSTRUMENTS, i)} />)}
          </Row>
        )}
        {ask?.useOfFunds ? (
          <Body muted><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>The money goes to: </Text>{ask.useOfFunds}</Body>
        ) : null}

        {data.isOwner ? (
          <Meta>This is how investors see your ask. Applications arrive under Investors in your project manager.</Meta>
        ) : active ? (
          <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: spacing.md, gap: spacing.sm }}>
            <Row center gap={6}>
              <Icon name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>
                You applied · {INVESTMENT_STATUS_LABEL[data.mine!.status]}
              </Text>
            </Row>
            <Btn label="Withdraw" variant="ghost" small loading={withdraw.isPending} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
              onPress={() => withdraw.mutate(data.mine!.id)} />
          </View>
        ) : (
          <Btn label="Apply to invest" icon="send-outline" onPress={() => { setError(null); setOpen(true); }} />
        )}
        <Meta style={{ lineHeight: 16 }}>{data.disclaimer}</Meta>
      </Block>

      <ProjectFormSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Apply to invest"
        subtitle="The founder reads every application and gets in touch if it's a fit."
        action="Send application"
        actionIcon="send"
        actionDisabled={!ready}
        actionLoading={apply.isPending}
        onAction={() => apply.mutate()}
        footerNote={error ? <ErrorNote message={error} /> : null}
      >
        <FormGroup label="How much would you consider?">
          <ChoicePills options={INVESTMENT_AMOUNTS} value={form.amount} onChange={(amount) => set({ amount })} />
        </FormGroup>
        <FormGroup label="How would you invest?">
          <ChoicePills options={INVESTMENT_INSTRUMENTS} value={form.instrument} onChange={(instrument) => set({ instrument })} />
        </FormGroup>
        <FormGroup label="What kind of investor are you?">
          <ChoicePills options={INVESTOR_TYPES} value={form.investorType} onChange={(investorType) => set({ investorType })} />
        </FormGroup>
        <FormGroup label="Are you an accredited investor?" hint="Broadly, $200k+ income or $1M+ net worth excluding your home. It changes what a founder can legally offer you.">
          <ChoicePills options={ACCREDITED_ANSWERS} value={form.accredited} onChange={(accredited) => set({ accredited })} />
        </FormGroup>
        <FormGroup label="About you, and why this project" hint="At least a couple of sentences.">
          <Field value={form.message} onChangeText={(message) => set({ message })} multiline maxLength={INVESTMENT_MESSAGE_MAX}
            placeholder="What you do, what you've backed before, and what drew you here." />
          <Meta style={{ textAlign: "right" }}>{form.message.trim().length < 20 ? `${20 - form.message.trim().length} more characters` : `${form.message.length}/${INVESTMENT_MESSAGE_MAX}`}</Meta>
        </FormGroup>
        <Field label="Phone (optional)" value={form.phone} onChangeText={(phone) => set({ phone })} placeholder="+1 555 123 4567" />
        <Field label="LinkedIn URL (optional)" value={form.linkedinUrl} onChangeText={(linkedinUrl) => set({ linkedinUrl })} placeholder="https://linkedin.com/in/you" autoCapitalize="none" />
        <CheckRow checked={form.consent} onChange={(consent) => set({ consent })}
          label="I understand this is an application to talk, not an investment, and the founder will see my name, email and the details above." />
      </ProjectFormSheet>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 2 }}>
      <Meta>{label}</Meta>
      <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>{value}</Text>
    </View>
  );
}
