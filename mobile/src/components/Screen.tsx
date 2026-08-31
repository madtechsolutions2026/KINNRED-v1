import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (keyboard-dismissing). Default false. */
  scroll?: boolean;
  edges?: readonly Edge[];
  contentStyle?: ViewStyle;
  /** Horizontal gutter. Default 20. */
  gutter?: number;
}

/**
 * Standard screen shell: safe-area background, keyboard avoidance, and a
 * consistent horizontal gutter. Every route renders inside one of these.
 */
export function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  contentStyle,
  gutter = spacing[6],
}: ScreenProps) {
  const { colors } = useTheme();
  const body = (
    <View style={[styles.body, { paddingHorizontal: gutter }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
