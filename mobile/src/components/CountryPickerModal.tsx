import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRIES, type Country } from '@/lib/countries';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';
import { AppText } from './AppText';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (c: Country) => void;
  selectedCode: string;
}

export function CountryPickerModal({
  visible,
  onClose,
  onSelect,
  selectedCode,
}: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <AppText variant="headline">Select country</AppText>
          <Pressable onPress={onClose} hitSlop={12}>
            <AppText variant="bodyStrong" color="brand">
              Done
            </AppText>
          </Pressable>
        </View>

        <View
          style={[
            styles.search,
            { backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder },
          ]}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            style={[
              typeScale.body,
              styles.searchInput,
              { color: colors.text },
              noWebOutline,
            ]}
          />
        </View>

        <FlatList
          data={results}
          keyExtractor={(c) => c.code}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing[6] }}
          renderItem={({ item }) => {
            const active = item.code === selectedCode;
            return (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderBottomColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceHover : 'transparent',
                  },
                ]}
              >
                <AppText style={styles.flag}>{item.flag}</AppText>
                <AppText variant="body" style={styles.countryName}>
                  {item.name}
                </AppText>
                <AppText
                  variant="subhead"
                  color={active ? 'brand' : 'textMuted'}
                >
                  {item.dial}
                </AppText>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    paddingBottom: spacing[5],
  },
  search: {
    marginHorizontal: spacing[6],
    marginBottom: spacing[4],
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  searchInput: { padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[4],
  },
  flag: { fontSize: 22 },
  countryName: { flex: 1 },
});
