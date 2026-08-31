import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Button } from './Button';
import { SelectChip } from './SelectChip';
import { SettingRow } from './SettingRow';
import {
  GRID_RADII,
  RADIUS_LABELS,
  DEFAULT_RADIUS,
  type GridRadius,
  type NearbyFilters,
} from '@/lib/grid-api';
import { LOOKING_FOR_LABELS, type LookingFor } from '@/lib/users-api';
import type { Gender } from '@/lib/auth-api';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Not specified' },
];

const LOOKING_FOR: LookingFor[] = [
  'DATING',
  'FRIENDSHIP',
  'NETWORKING',
  'ACTIVITY_PARTNERS',
  'JUST_EXPLORING',
];

interface Props {
  visible: boolean;
  initial: NearbyFilters;
  onClose: () => void;
  onApply: (filters: NearbyFilters) => void;
}

export function GridFilterSheet({ visible, initial, onClose, onApply }: Props) {
  const { colors } = useTheme();
  const [radiusMeters, setRadius] = useState<GridRadius>(
    initial.radiusMeters ?? DEFAULT_RADIUS,
  );
  const [minAge, setMinAge] = useState(initial.minAge?.toString() ?? '');
  const [maxAge, setMaxAge] = useState(initial.maxAge?.toString() ?? '');
  const [genders, setGenders] = useState<Gender[]>(initial.genders ?? []);
  const [lookingFor, setLookingFor] = useState<LookingFor[]>(
    initial.lookingFor ?? [],
  );
  const [onlineOnly, setOnlineOnly] = useState(!!initial.onlineOnly);

  useEffect(() => {
    if (!visible) return;
    setRadius(initial.radiusMeters ?? DEFAULT_RADIUS);
    setMinAge(initial.minAge?.toString() ?? '');
    setMaxAge(initial.maxAge?.toString() ?? '');
    setGenders(initial.genders ?? []);
    setLookingFor(initial.lookingFor ?? []);
    setOnlineOnly(!!initial.onlineOnly);
  }, [visible, initial]);

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const clampAge = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return undefined;
    return Math.min(120, Math.max(18, n));
  };

  function apply() {
    const lo = clampAge(minAge);
    const hi = clampAge(maxAge);
    onApply({
      radiusMeters,
      minAge: lo,
      maxAge: hi != null && lo != null && hi < lo ? lo : hi,
      genders: genders.length ? genders : undefined,
      lookingFor: lookingFor.length ? lookingFor : undefined,
      onlineOnly: onlineOnly || undefined,
    });
    onClose();
  }

  function reset() {
    setRadius(DEFAULT_RADIUS);
    setMinAge('');
    setMaxAge('');
    setGenders([]);
    setLookingFor([]);
    setOnlineOnly(false);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <SafeAreaView
          edges={['bottom']}
          style={[styles.sheet, { backgroundColor: colors.bgElevated }]}
        >
          <View style={styles.header}>
            <AppText variant="headline">Filters</AppText>
            <Pressable onPress={reset} hitSlop={8}>
              <AppText variant="subhead" color="textMuted">
                Reset
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            <Group title="Distance">
              <View style={styles.chips}>
                {GRID_RADII.map((r) => (
                  <SelectChip
                    key={r}
                    label={RADIUS_LABELS[r].replace('Within ', '')}
                    selected={radiusMeters === r}
                    onPress={() => setRadius(r)}
                  />
                ))}
              </View>
            </Group>

            <Group title="Age">
              <View style={styles.ageRow}>
                <AgeInput
                  value={minAge}
                  onChange={setMinAge}
                  placeholder="18"
                />
                <AppText variant="body" color="textFaint">
                  to
                </AppText>
                <AgeInput
                  value={maxAge}
                  onChange={setMaxAge}
                  placeholder="120"
                />
              </View>
            </Group>

            <Group title="Gender">
              <View style={styles.chips}>
                {GENDERS.map((g) => (
                  <SelectChip
                    key={g.value}
                    label={g.label}
                    selected={genders.includes(g.value)}
                    onPress={() => setGenders((c) => toggle(c, g.value))}
                  />
                ))}
              </View>
            </Group>

            <Group title="Looking for">
              <View style={styles.chips}>
                {LOOKING_FOR.map((l) => (
                  <SelectChip
                    key={l}
                    label={LOOKING_FOR_LABELS[l]}
                    selected={lookingFor.includes(l)}
                    onPress={() => setLookingFor((c) => toggle(c, l))}
                  />
                ))}
              </View>
            </Group>

            <View style={[styles.onlineCard, { borderColor: colors.border }]}>
              <SettingRow
                label="Online right now"
                description="Only people whose location updated in the last few minutes."
                value={onlineOnly}
                onValueChange={setOnlineOnly}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button label="Show results" onPress={apply} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="overline" color="textFaint">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function AgeInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 3))}
      keyboardType="number-pad"
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      style={[
        typeScale.headline,
        styles.ageInput,
        {
          color: colors.text,
          backgroundColor: colors.fieldBg,
          borderColor: colors.fieldBorder,
        },
        noWebOutline,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[6],
    paddingBottom: spacing[4],
  },
  body: { paddingHorizontal: spacing[6], paddingBottom: spacing[6], gap: spacing[7] },
  group: { gap: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  ageInput: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing[5],
    textAlign: 'center',
  },
  onlineCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing[5],
  },
  footer: {
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
});
