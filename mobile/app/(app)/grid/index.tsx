import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { PersonCard } from "@/components/PersonCard";
import { DiscoveryToolbar } from "@/components/DiscoveryToolbar";
import { GridFilterSheet } from "@/components/GridFilterSheet";
import { PlansPanel } from "@/components/PlansPanel";
import { BrandGradient } from "@/components/BrandGradient";
import { useGrid } from "@/lib/useGrid";
import { usePings } from "@/lib/pings";
import { useProfile } from "@/lib/profile";
import {
  DEFAULT_RADIUS,
  RADIUS_LABELS,
  type NearbyFilters,
  type NearbyPerson,
} from "@/lib/grid-api";
import type { LookingFor } from "@/lib/users-api";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/theme";
const QUICK_FILTERS: {
  label: string;
  value?: LookingFor;
  online?: boolean;
  plans?: boolean;
}[] = [
  { label: "Nearby" },
  { label: "Plans", plans: true },
  { label: "Online", online: true },
  { label: "Activities", value: "ACTIVITY_PARTNERS" },
  { label: "Friends", value: "FRIENDSHIP" },
  { label: "Dating", value: "DATING" },
  { label: "Networking", value: "NETWORKING" },
];
export default function GridScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const g = useGrid();
  const { badgeCount } = usePings();
  const { profile } = useProfile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [plans, setPlans] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cardWidth = (Math.min(width, 480) - 48) / 3;
  const matches = useMemo(
    () =>
      g.people.filter(
        (p) =>
          p.publicShortId !== profile?.publicShortId &&
          (!query.trim() ||
            (p.displayName ?? "")
              .toLowerCase()
              .includes(query.trim().toLowerCase()) ||
            p.interests.some((v) =>
              v.toLowerCase().includes(query.trim().toLowerCase()),
            )),
      ),
    [g.people, query, profile?.publicShortId],
  );
  const self = useMemo<NearbyPerson | null>(
    () =>
      profile
        ? {
            publicShortId: profile.publicShortId,
            displayName: profile.displayName,
            gender: profile.gender,
            age: profile.age,
            isVerified: profile.isVerified,
            interests: profile.interests,
            lookingFor: profile.lookingFor,
            distance: "You",
            online: true,
            photo: profile.photos[0] ?? null,
            photosBlurred: false,
          }
        : null,
    [profile],
  );
  const people = self ? [self, ...matches] : matches;
  function select(f: (typeof QUICK_FILTERS)[number]) {
    setPlans(!!f.plans);
    if (f.plans) return;
    g.setFilters({
      ...g.filters,
      onlineOnly: f.online || undefined,
      lookingFor: f.value ? [f.value] : undefined,
    });
  }
  const locationNotice =
    g.phase === "locating" ? (
      <View style={styles.notice}>
        <ActivityIndicator color={colors.brand} />
        <AppText variant="footnote" color="textMuted">
          Finding people nearby…
        </AppText>
      </View>
    ) : g.phase !== "ready" ? (
      <View style={styles.notice}>
        <AppText variant="headline">
          {g.phase === "error" ? "Let’s reconnect" : "Your people are nearby"}
        </AppText>
        <AppText variant="footnote" color="textMuted" align="center">
          {g.message}
        </AppText>
        <Button
          label={g.phase === "error" ? "Try again" : "Enable location"}
          fullWidth={false}
          onPress={g.retry}
        />
        {__DEV__ && (
          <Button
            label="Use demo location"
            variant="ghost"
            fullWidth={false}
            onPress={g.useDemoLocation}
          />
        )}
      </View>
    ) : null;
  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <DiscoveryToolbar
        onPings={() => router.push("/pings")}
        pingCount={badgeCount}
        onSearch={() => {
          setPlans(false);
          setSearchOpen((v) => !v);
          setQuery("");
        }}
        onFilters={() => setFiltersOpen(true)}
        filterCount={g.activeFilterCount}
      />
      {searchOpen && !plans && (
        <View style={[styles.search, { borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={17} color={colors.textMuted} />
          <TextInput
            accessibilityLabel="Search these people"
            placeholder="Search these people"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            style={[styles.searchInput, { color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            onPress={() => {
              setSearchOpen(false);
              setQuery("");
            }}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
      <View style={styles.chipArea}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {QUICK_FILTERS.map((f) => {
            const active = f.plans
              ? plans
              : !plans &&
                (f.online
                  ? !!g.filters.onlineOnly
                  : f.value
                    ? g.filters.lookingFor?.length === 1 &&
                      g.filters.lookingFor[0] === f.value &&
                      !g.filters.onlineOnly
                    : !g.filters.onlineOnly && !g.filters.lookingFor?.length);
            return (
              <Pressable
                key={f.label}
                accessibilityRole="button"
                accessibilityLabel={f.label + " filter"}
                accessibilityState={{ selected: active }}
                onPress={() => select(f)}
                style={[
                  styles.chip,
                  { borderColor: active ? "transparent" : colors.border },
                ]}
              >
                {active && <BrandGradient />}
                <AppText
                  style={[
                    styles.chipText,
                    { color: active ? "#FFFFFF" : colors.textMuted },
                  ]}
                >
                  {f.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.radiusRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change distance radius"
          onPress={() => setFiltersOpen(true)}
          style={[styles.radius, { backgroundColor: colors.brandSoft }]}
        >
          <Ionicons name="location-outline" size={13} color={colors.brand} />
          <AppText variant="caption" color="brand">
            {RADIUS_LABELS[g.filters.radiusMeters ?? DEFAULT_RADIUS]}
          </AppText>
          <Ionicons name="chevron-down" size={12} color={colors.brand} />
        </Pressable>
        <AppText variant="caption" color="textFaint">
          {plans ? "Find your next plan" : "Your profile appears first"}
        </AppText>
      </View>
      {plans ? (
        <PlansPanel
          radiusMeters={g.filters.radiusMeters ?? DEFAULT_RADIUS}
          locationReady={g.phase === "ready"}
        />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.publicShortId}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={g.refreshing}
              onRefresh={() => {
                void g.refresh();
              }}
              tintColor={colors.brand}
            />
          }
          ListHeaderComponent={locationNotice}
          onEndReached={g.loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            g.loadingMore ? (
              <ActivityIndicator color={colors.brand} />
            ) : g.phase === "ready" && !matches.length ? (
              <View style={styles.notice}>
                <AppText variant="headline" align="center">
                  Room for a new connection
                </AppText>
                <AppText variant="footnote" color="textMuted" align="center">
                  {query
                    ? "No matches. Try another name or interest."
                    : "Try a wider distance or a different filter."}
                </AppText>
                <Button
                  label="Adjust filters"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setFiltersOpen(true)}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <PersonCard
              person={item}
              width={cardWidth}
              isSelf={item.publicShortId === profile?.publicShortId}
              onPress={() =>
                router.push(
                  item.publicShortId === profile?.publicShortId
                    ? "/myspace"
                    : "/grid/" + item.publicShortId,
                )
              }
            />
          )}
        />
      )}
      <GridFilterSheet
        visible={filtersOpen}
        initial={g.filters}
        onClose={() => setFiltersOpen(false)}
        onApply={g.setFilters}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  chipArea: { height: 46, flexShrink: 0 },
  chips: {
    gap: 7,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    alignItems: "center",
  },
  chip: {
    minHeight: 32,
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  chipText: { fontFamily: fontFamily.bodyMedium, fontSize: 11, lineHeight: 16 },
  radiusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  radius: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.body,
    fontSize: 13,
    padding: 0,
  },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 112 },
  row: { gap: 8, marginBottom: 8 },
  notice: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
});
