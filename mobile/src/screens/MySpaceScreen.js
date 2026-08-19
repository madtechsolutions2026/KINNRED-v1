import React, { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { demoProfile } from '../data/fixtures';

import ScreenHeader from '../components/ScreenHeader';
import Card, { Divider } from '../components/Card';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import DemoBanner from '../components/DemoBanner';

/**
 * MySpace — profile, media, identity and privacy settings.
 *
 * Sections, in the prototype's order: identity header -> photo slots ->
 * unique handle -> aesthetics -> privacy toggles -> discovery preferences ->
 * Plus upsell -> sign out.
 */
export default function MySpaceScreen() {
  const { colors, type, space, layout, radius, isDark, toggleTheme, elevation } = useTheme();
  const { user, isDemo, signOut } = useSession();

  const profile = user ?? demoProfile;
  const [settings, setSettings] = useState(demoProfile.settings);
  const set = (key) => (v) => setSettings((prev) => ({ ...prev, [key]: v }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="MySpace"
        subtitle="Your profile and privacy"
        actions={[
          {
            key: 'theme',
            name: isDark ? 'sunny-outline' : 'moon-outline',
            onPress: toggleTheme,
            accessibilityLabel: 'Toggle theme',
          },
          { key: 'qr', name: 'qr-code-outline', accessibilityLabel: 'Share my profile' },
        ]}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: layout.screenPaddingX,
          paddingBottom: layout.contentBottomPad,
          gap: space.md,
        }}
      >
        {isDemo || !user ? <DemoBanner /> : null}

        {/* Identity */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <Avatar person={profile} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[type.displaySm, { color: colors.foreground }]}>
                {profile.displayName}
                {profile.age ? (
                  <Text style={{ fontWeight: '400', color: colors.mutedForeground }}>
                    {`, ${profile.age}`}
                  </Text>
                ) : null}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' }}>
                {profile.neighbourhood ? (
                  <Badge label={profile.neighbourhood} icon="location-outline" size="sm" />
                ) : null}
                {profile.isVerified ? (
                  <Badge label="Verified" icon="checkmark-circle" tone="positive" size="sm" />
                ) : null}
              </View>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                marginTop: space.lg,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.sm,
                paddingVertical: space.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.muted,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="qr-code-outline" size={16} color={colors.foreground} />
            <Text style={[type.chip, { color: colors.foreground, fontWeight: '600' }]}>
              Share my profile
            </Text>
          </Pressable>
        </Card>

        {/* Photos */}
        <Section
          title="Photos"
          hint="Tap a slot to upload. The first photo is your main image."
        >
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <PhotoSlot key={i} index={i} primary={i === 0} />
            ))}
          </View>
        </Section>

        {/* Handle */}
        <Section title="Unique ID" hint="3–18 characters. Letters, numbers and underscores only.">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={[type.body, { color: colors.mutedForeground }]}>@</Text>
            <Text style={[type.body, { color: colors.mutedForeground, flex: 1 }]}>
              {profile.handle ?? 'claim your handle'}
            </Text>
            <Badge label="Available" tone="positive" size="sm" />
          </View>
        </Section>

        {/* Aesthetics */}
        <Section
          title="Aesthetics"
          hint="Up to three mood images, shown in place of your photos while they are locked."
        >
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[0, 1, 2].map((i) => (
              <PhotoSlot key={i} index={i + 10} aspect={1} />
            ))}
          </View>
        </Section>

        {/* Privacy */}
        <Section title="Privacy" padded={false}>
          <SettingRow
            icon="lock-closed-outline"
            label="Lock my photos"
            hint="Unlocks only for people you ping, or whose ping you accept."
            value={settings.photosLocked}
            onValueChange={set('photosLocked')}
          />
          <Divider inset={52} />
          <SettingRow
            icon="shield-checkmark-outline"
            label="Show verified badge"
            value={settings.showVerifiedBadge}
            onValueChange={set('showVerifiedBadge')}
          />
          <Divider inset={52} />
          <SettingRow
            icon="navigate-outline"
            label="Approximate distance"
            hint="Exact GPS is never shared. This cannot be turned off."
            value
            disabled
          />
          <Divider inset={52} />
          <SettingRow
            icon="eye-off-outline"
            label="Incognito viewing"
            hint="Browse the Grid without appearing in other people's viewer lists."
            value={settings.incognitoViewing}
            onValueChange={set('incognitoViewing')}
          />
          <Divider inset={52} />
          <SettingRow
            icon="notifications-outline"
            label="Push notifications"
            value={settings.pushNotifications}
            onValueChange={set('pushNotifications')}
          />
        </Section>

        {/* Discovery */}
        <Section title="Discovery" hint="What you're here for, and who you want to see.">
          <View style={{ gap: space.md }}>
            <ChipRow label="Looking for" options={['Friends', 'Activities', 'Dating', 'Networking']} />
            <ChipRow label="Show me" options={['Everyone', 'Women', 'Men', 'Non-binary']} single />
          </View>
        </Section>

        {/* Plus */}
        <Card padded={false} elevation={3}>
          <LinearGradient
            colors={[colors.signal, colors.radar]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: space.lg, gap: space.sm }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
              <Text style={[type.title, { color: '#FFFFFF' }]}>Try Plus — ₹299/mo</Text>
            </View>
            <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.92)' }]}>
              See who viewed your profile, read receipts, and unlimited pings.
            </Text>
          </LinearGradient>
        </Card>

        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space.sm,
              paddingVertical: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="log-out-outline" size={16} color={colors.destructive} />
          <Text style={[type.chip, { color: colors.destructive, fontWeight: '600' }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/* ----------------------------- sub-components ---------------------------- */

function Section({ title, hint, children, padded = true }) {
  const { colors, type, space } = useTheme();
  return (
    <Card padded={false}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: hint ? 0 : space.sm }}>
        <Text style={[type.title, { color: colors.foreground }]}>{title}</Text>
        {hint ? (
          <Text style={[type.caption, { color: colors.mutedForeground, marginTop: 4 }]}>{hint}</Text>
        ) : null}
      </View>
      <View style={padded ? { padding: space.lg } : { paddingVertical: space.sm }}>{children}</View>
    </Card>
  );
}

function PhotoSlot({ index, primary, aspect = 3 / 4 }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={primary ? 'Upload main photo' : `Upload photo ${index + 1}`}
      style={({ pressed }) => [
        {
          width: 62,
          aspectRatio: aspect,
          borderRadius: radius.md,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.border,
          backgroundColor: colors.muted,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="add" size={16} color={colors.mutedForeground} />
      {primary ? (
        <Text style={[type.badge, { color: colors.mutedForeground, fontSize: 8 }]}>MAIN</Text>
      ) : null}
    </Pressable>
  );
}

function SettingRow({ icon, label, hint, value, onValueChange, disabled }) {
  const { colors, type, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={colors.mutedForeground} style={{ width: 20 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: colors.foreground }]}>{label}</Text>
        {hint ? (
          <Text style={[type.caption, { color: colors.mutedForeground }]}>{hint}</Text>
        ) : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.signal }}
        thumbColor={colors.card}
        // react-native-web ignores `thumbColor` for the ON state and uses its
        // own green default, so the active colours have to be named too.
        activeThumbColor={colors.card}
        activeTrackColor={colors.signal}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

function ChipRow({ label, options, single }) {
  const { colors, type, space, radius } = useTheme();
  const [selected, setSelected] = useState(single ? [options[0]] : [options[0], options[1]]);

  const toggle = (opt) =>
    setSelected((prev) => {
      if (single) return [opt];
      return prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt];
    });

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.caption, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              onPress={() => toggle(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                {
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? 'transparent' : colors.border,
                  backgroundColor: active ? colors.foreground : colors.card,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                style={[type.chip, { color: active ? colors.background : colors.mutedForeground }]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
