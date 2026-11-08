import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Field } from "./Field";
import { SelectChip } from "./SelectChip";
import { BrandGradient } from "./BrandGradient";
import {
  cancelPlan,
  createPlan,
  decidePlan,
  getPlans,
  requestPlan,
  withdrawPlan,
  type Plan,
} from "@/lib/plans-api";
import type { GridRadius } from "@/lib/grid-api";
import { useTheme } from "@/theme/theme";
export function PlansPanel({
  radiusMeters,
  locationReady,
}: {
  radiusMeters?: GridRadius;
  locationReady: boolean;
}) {
  const { colors } = useTheme();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await getPlans(radiusMeters, mine);
      setPlans(r.results);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plans.");
    } finally {
      setLoading(false);
    }
  }, [radiusMeters, mine]);
  useEffect(() => {
    void load();
  }, [load, locationReady]);
  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await getPlans(radiusMeters, mine, cursor);
      setPlans((p) => [
        ...p,
        ...r.results.filter(
          (n) => !p.some((v) => v.publicShortId === n.publicShortId),
        ),
      ]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plans.");
    } finally {
      setLoadingMore(false);
    }
  }
  async function act(key: string, task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await task();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Make a little plan.</AppText>
          <AppText variant="caption" color="textMuted">
            Good company starts with an invitation.
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a plan"
          onPress={() => setCreating(true)}
          style={styles.plus}
        >
          <BrandGradient />
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.switches}>
        <SelectChip
          label="Nearby plans"
          selected={!mine}
          onPress={() => setMine(false)}
        />
        <SelectChip
          label="My plans"
          selected={mine}
          onPress={() => setMine(true)}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={colors.brand}
          />
        }
      >
        {error && (
          <AppText variant="footnote" color="danger">
            {error}
          </AppText>
        )}
        {radiusMeters !== undefined && !locationReady && !mine && (
          <AppText variant="footnote" color="textMuted">
            Enable location on Nearby to discover plans around you. Your own
            plans appear here too.
          </AppText>
        )}
        {!loading && !plans.length && (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color={colors.brand} />
            <AppText variant="headline">Be the first to make a plan</AppText>
            <AppText variant="footnote" color="textMuted" align="center">
              Coffee, a walk, a game. Pick a time and a public place.
            </AppText>
            <Button
              label="Create a plan"
              fullWidth={false}
              onPress={() => setCreating(true)}
            />
          </View>
        )}
        {plans.map((p) => (
          <View
            key={p.publicShortId}
            style={[
              styles.card,
              {
                borderColor: colors.border,
                backgroundColor: colors.bgElevated,
              },
            ]}
          >
            <View style={styles.meta}>
              <Ionicons
                name="calendar-outline"
                size={14}
                color={colors.brand}
              />
              <AppText variant="caption" color="brand">
                {new Date(p.startsAt).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </AppText>
            </View>
            <AppText variant="headline">{p.title}</AppText>
            <View style={styles.meta}>
              <Ionicons
                name="location-outline"
                size={15}
                color={colors.textMuted}
              />
              <AppText variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {p.place}
              </AppText>
            </View>
            {!!p.description && (
              <AppText variant="footnote">{p.description}</AppText>
            )}
            <AppText variant="caption" color="textMuted">
              {p.isOwner
                ? "Hosted by you"
                : `By ${p.owner.displayName ?? p.owner.username ?? "someone nearby"}`}{" "}
              · {p.acceptedCount} joining
            </AppText>
            {p.isOwner ? (
              <>
                {p.requests.map((request) => (
                  <View
                    key={request.publicShortId}
                    style={[styles.request, { borderColor: colors.border }]}
                  >
                    <AppText variant="footnote" style={{ flex: 1 }}>
                      {request.displayName ?? request.publicShortId}
                      {request.state !== "PENDING"
                        ? ` · ${request.state.toLowerCase()}`
                        : ""}
                    </AppText>
                    {request.state === "PENDING" && (
                      <>
                        <Pressable
                          disabled={!!busy}
                          accessibilityRole="button"
                          accessibilityLabel={`Accept ${request.displayName ?? request.publicShortId}`}
                          onPress={() =>
                            void act(p.publicShortId, () =>
                              decidePlan(
                                p.publicShortId,
                                request.publicShortId,
                                "ACCEPTED",
                              ),
                            )
                          }
                        >
                          <Ionicons
                            name="checkmark-circle"
                            size={28}
                            color={colors.brand}
                          />
                        </Pressable>
                        <Pressable
                          disabled={!!busy}
                          accessibilityRole="button"
                          accessibilityLabel={`Decline ${request.displayName ?? request.publicShortId}`}
                          onPress={() =>
                            void act(p.publicShortId, () =>
                              decidePlan(
                                p.publicShortId,
                                request.publicShortId,
                                "REJECTED",
                              ),
                            )
                          }
                        >
                          <Ionicons
                            name="close-circle-outline"
                            size={28}
                            color={colors.textMuted}
                          />
                        </Pressable>
                      </>
                    )}
                  </View>
                ))}
                <Button
                  label="Cancel plan"
                  variant="ghost"
                  disabled={!!busy}
                  onPress={() =>
                    void act(p.publicShortId, () => cancelPlan(p.publicShortId))
                  }
                />
              </>
            ) : p.myRequest ? (
              <>
                <AppText
                  variant="footnote"
                  color={p.myRequest === "ACCEPTED" ? "success" : "textMuted"}
                >
                  {p.myRequest === "PENDING"
                    ? "Request sent · waiting for the host"
                    : p.myRequest === "ACCEPTED"
                      ? "You’re in! See you there."
                      : "The host declined your request."}
                </AppText>
                <Button
                  label={
                    p.myRequest === "ACCEPTED"
                      ? "Leave plan"
                      : "Withdraw request"
                  }
                  variant="ghost"
                  disabled={!!busy}
                  onPress={() =>
                    void act(p.publicShortId, () =>
                      withdrawPlan(p.publicShortId),
                    )
                  }
                />
              </>
            ) : (
              <Button
                label="Request to join"
                loading={busy === p.publicShortId}
                disabled={!!busy}
                onPress={() =>
                  void act(p.publicShortId, () => requestPlan(p.publicShortId))
                }
              />
            )}
          </View>
        ))}
        {!!cursor && (
          <Button
            label="More plans"
            variant="secondary"
            loading={loadingMore}
            onPress={() => void more()}
          />
        )}
        {loading && !plans.length && <ActivityIndicator color={colors.brand} />}
      </ScrollView>
      <CreatePlanModal
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />
    </View>
  );
}
function CreatePlanModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { colors } = useTheme();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (saving) return;
    setError(null);
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
    const t = /^(\d{2}):(\d{2})$/.exec(time);
    if (!d || !t) {
      setError("Enter the date as DD/MM/YYYY and the time as HH:MM (24-hour).");
      return;
    }
    const dt = new Date(+d[3], +d[2] - 1, +d[1], +t[1], +t[2]);
    if (
      dt.getDate() !== +d[1] ||
      dt.getMonth() !== +d[2] - 1 ||
      +t[1] > 23 ||
      +t[2] > 59 ||
      dt.getTime() <= Date.now()
    ) {
      setError("Choose a valid future date and time.");
      return;
    }
    setSaving(true);
    try {
      await createPlan({
        title: title.trim(),
        description: description.trim(),
        place: place.trim(),
        startsAt: dt.toISOString(),
      });
      setTitle("");
      setDescription("");
      setPlace("");
      setDate("");
      setTime("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create plan.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <AppText variant="title">Create a plan</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close create plan"
              onPress={onClose}
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.list, { gap: 20 }]}
          >
            <Field
              label="What’s the plan?"
              placeholder="Coffee and a good conversation"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
            />
            <Field
              label="Public meeting place"
              placeholder="Cafe name or public park"
              hint="Pick a public venue. Avoid sharing a home address."
              value={place}
              onChangeText={setPlace}
              maxLength={120}
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Date"
                  placeholder="DD/MM/YYYY"
                  value={date}
                  onChangeText={setDate}
                  maxLength={10}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Local time"
                  placeholder="HH:MM"
                  value={time}
                  onChangeText={setTime}
                  maxLength={5}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <AppText variant="caption" color="textMuted">
              Use 24-hour time in your current time zone. Plan up to 180 days
              ahead.
            </AppText>
            <Field
              label="A little more detail"
              placeholder="What should people know?"
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              multiline
            />
            {error && (
              <AppText variant="footnote" color="danger">
                {error}
              </AppText>
            )}
            <Button
              label="Publish plan"
              onPress={() => void save()}
              loading={saving}
              disabled={
                title.trim().length < 3 ||
                place.trim().length < 3 ||
                !date ||
                !time
              }
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  plus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  switches: {
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    paddingBottom: 12,
  },
  list: { paddingHorizontal: 16, paddingBottom: 116, gap: 14 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 10 },
  meta: { flexDirection: "row", gap: 6, alignItems: "center" },
  empty: {
    paddingTop: 30,
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
  },
  request: {
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
